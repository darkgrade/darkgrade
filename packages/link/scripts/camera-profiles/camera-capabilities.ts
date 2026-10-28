import { identifyCamera } from '@camera/identification/camera-identification'
import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import type { EventDefinition } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { CapabilityResult } from '@scripts/camera-profiles/support-matrix'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { IPTransport } from '@transport/ip/ip-transport'
import {
    formatCode,
    parseBytes,
    parseCode,
    type CameraProfile,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { SimulatedPtpIpCamera } from '@transport/simulated/simulated-ptpip-camera'
import { SimulatedDisconnectError, SimulatedTransport } from '@transport/simulated/simulated-transport'
import { isDeepStrictEqual } from 'node:util'

const OK = 0x2001
const CAMERA_REPORTS_UNSUPPORTED = new Set([0x2005, 0x200a])
const SIMULATED_TIMEOUT_MILLISECONDS = 5_000

/** The capability cannot be exercised because the profile lacks the required captured data. */
class NoProfileData extends Error {}
/** darkgrade or the camera does not offer the capability. */
class NotOffered extends Error {}
/** darkgrade waited for camera output the profile never produces. */
class TimedOut extends Error {}

/** What the capability classifier reads from a transport: response codes and requests the profile could not answer. */
export interface ObservedTransport {
    readonly missingData: readonly { message: string }[]
    readonly responseCodes: readonly number[]
}

/**
 * A camera the capabilities run against: a SimulatedTransport answering from `profile`, or a physical
 * camera (tier "hardware") whose captured `profile` supplies the expected values.
 */
export interface SimulatedCamera {
    profile: CameraProfile
    camera: Camera
    transport: ObservedTransport
    tier: 'simulated' | 'hardware'
    /** The link darkgrade talks over (default "usb"); "ptp-ip" is standard PTP/IP over Wi-Fi/Ethernet. */
    connection?: CameraConnection
    /** Passed to Camera.connect(); selects the physical camera on the hardware tier. */
    device?: DeviceDescriptor
    timeoutMilliseconds: number
    /** Set only after fresh GetDeviceInfo passes the profile identity and dataset checks. */
    verifiedDeviceInfo?: { manufacturer: string; model: string; deviceVersion: string }
}

export function simulateCamera(profile: CameraProfile): SimulatedCamera {
    const transport = new SimulatedTransport(profile)
    const camera = new Camera({
        transport,
        vendorId: profile.usb ? parseCode(profile.usb.vendorId) : undefined,
        logger: { renderInTerminal: false, captureConsole: false, expanded: false },
    })
    return {
        profile,
        camera,
        transport,
        tier: 'simulated',
        connection: 'usb',
        timeoutMilliseconds: SIMULATED_TIMEOUT_MILLISECONDS,
    }
}

export type CameraConnection = 'usb' | 'ptp-ip'

/**
 * Serves the profile over standard PTP/IP on a loopback port and connects darkgrade's IPTransport to
 * it. Call `stop()` when done.
 */
export async function simulateCameraOverPtpIp(
    profile: CameraProfile
): Promise<SimulatedCamera & { stop: () => Promise<void> }> {
    const server = new SimulatedPtpIpCamera(profile)
    const { host, port } = await server.start()
    const camera = new Camera({
        transport: new IPTransport(
            { address: host, port, timeout: SIMULATED_TIMEOUT_MILLISECONDS },
            new Logger({ renderInTerminal: false, captureConsole: false, expanded: false })
        ),
        vendorId: profile.usb ? parseCode(profile.usb.vendorId) : undefined,
        logger: { renderInTerminal: false, captureConsole: false, expanded: false },
    })
    return {
        profile,
        camera,
        transport: server.transport,
        tier: 'simulated',
        connection: 'ptp-ip',
        timeoutMilliseconds: SIMULATED_TIMEOUT_MILLISECONDS,
        stop: async () => {
            await camera.disconnect().catch(() => undefined)
            await server.stop()
        },
    }
}

/** Replaying captured traffic can change settings or card contents, so the hardware tier never does it. */
function refuseReplayOnHardware(simulated: SimulatedCamera): void {
    if (simulated.tier === 'hardware') throw new NoProfileData('captured traffic is not replayed on hardware')
}

function registryOf(simulated: SimulatedCamera) {
    return simulated.camera.getInstance().registry
}

function findProperty(simulated: SimulatedCamera, code: number): PropertyDefinition | undefined {
    return Object.values(registryOf(simulated).properties).find(property => property.code === code) as
        PropertyDefinition | undefined
}

function findOperation(simulated: SimulatedCamera, code: number): OperationDefinition | undefined {
    return Object.values(registryOf(simulated).operations).find(operation => operation.code === code) as
        OperationDefinition | undefined
}

async function connectSession(simulated: SimulatedCamera): Promise<string> {
    const responsesBefore = simulated.transport.responseCodes.length
    await simulated.camera.connect(simulated.device)
    if (simulated.transport.responseCodes.length === responsesBefore)
        throw new NoProfileData('Camera.connect() completed without a camera response')
    return 'Camera.connect() completed with a successful camera response'
}

async function readDeviceInfo(simulated: SimulatedCamera): Promise<string> {
    delete simulated.verifiedDeviceInfo
    const response = await simulated.camera.send(registryOf(simulated).operations.GetDeviceInfo, {})
    if (response.code !== OK || !response.data) throw new Error(`GetDeviceInfo returned ${formatCode(response.code)}`)
    const deviceInfo = response.data
    const identity = `${deviceInfo.manufacturer} ${deviceInfo.model}`
    const expected = simulated.profile.deviceInfo
    if (expected?.reportedIdentity && expected.reportedIdentity !== identity) {
        throw new Error(`decoded identity "${identity}", camera reported "${expected.reportedIdentity}"`)
    }
    if (expected?.model !== undefined && expected.model !== deviceInfo.model) {
        throw new Error(`decoded model "${deviceInfo.model}", profile has "${expected.model}"`)
    }
    if (!expected?.model && !expected?.reportedIdentity) {
        const aliases = new Set(
            [simulated.profile.model, simulated.profile.usb?.productString]
                .filter(Boolean)
                .map(value => value!.trim().toLowerCase())
        )
        for (const product of simulated.profile.usb?.productIds ?? []) {
            const lookup = identifyCamera({
                vendorId: parseCode(simulated.profile.usb!.vendorId),
                productId: parseCode(product),
            })
            for (const candidate of lookup.candidates.filter(candidate =>
                candidate.profiles.some(profile => profile.profileId === simulated.profile.id)
            ))
                candidate.models.forEach(model => aliases.add(model.trim().toLowerCase()))
        }
        if (!aliases.has(deviceInfo.model.trim().toLowerCase()))
            throw new Error(
                `GetDeviceInfo model "${deviceInfo.model}" does not match an exact alias for profile ${simulated.profile.id}`
            )
    }
    for (const [field, decoded] of [
        ['operationsSupported', deviceInfo.operationsSupportedRaw],
        ['eventsSupported', deviceInfo.eventsSupportedRaw],
        ['devicePropertiesSupported', deviceInfo.devicePropertiesSupported],
    ] as const) {
        const expectedCodes = expected?.[field]
        if (expectedCodes && !isDeepStrictEqual(expectedCodes.map(parseCode), decoded))
            throw new Error(`GetDeviceInfo ${field} differs from the source dataset`)
    }
    simulated.verifiedDeviceInfo = {
        manufacturer: deviceInfo.manufacturer,
        model: deviceInfo.model,
        deviceVersion: deviceInfo.deviceVersion,
    }
    return `${identity}; ${deviceInfo.operationsSupportedRaw.length} operations, ${deviceInfo.devicePropertiesSupported.length} properties`
}

async function listProperties(simulated: SimulatedCamera): Promise<string> {
    const response = await simulated.camera.send(registryOf(simulated).operations.GetDeviceInfo, {})
    if (response.code !== OK || !response.data) throw new Error(`GetDeviceInfo returned ${formatCode(response.code)}`)
    const advertised = response.data.devicePropertiesSupported
    const defined = advertised.filter(code => findProperty(simulated, code))
    if (advertised.length === 0) throw new NoProfileData('no advertised property list to exercise')
    if (defined.length === 0) throw new NotOffered('darkgrade has no definitions for the advertised properties')
    const states = await simulated.camera.getStandardPropertyStates()
    const decoded = new Set(states.map(state => state.code))
    const missing = defined.filter(code => !decoded.has(code))
    if (missing.length) {
        const incomplete = missing.some(
            code => !simulated.profile.properties.find(property => parseCode(property.code) === code)?.descriptor
        )
        if (simulated.tier === 'simulated' && incomplete)
            throw new NoProfileData(`missing descriptors for ${missing.map(code => formatCode(code)).join(' ')}`)
        throw new Error(
            `decoded ${states.length}/${defined.length} advertised properties; missing ${missing.map(code => formatCode(code)).join(' ')}`
        )
    }
    return `${states.length} advertised properties decoded`
}

/** Profile properties darkgrade has a definition for, preferring ones with captured descriptors. */
function candidateProperties(simulated: SimulatedCamera) {
    const properties = simulated.profile.properties.flatMap(property => {
        const definition = findProperty(simulated, parseCode(property.code))
        return definition ? [{ property, definition }] : []
    })
    if (simulated.profile.properties.length === 0) throw new NoProfileData('no captured properties')
    if (properties.length === 0) throw new NotOffered('darkgrade has no definitions for the captured properties')
    return properties.sort((left, right) => Number(!!right.property.descriptor) - Number(!!left.property.descriptor))
}

async function getProperty(simulated: SimulatedCamera): Promise<string> {
    const [{ property, definition }] = candidateProperties(simulated) as [ReturnType<typeof candidateProperties>[0]]
    const value = await simulated.camera.get(definition)
    if (value === undefined) throw new Error(`${definition.name} returned no value`)
    if (property.observedValue !== undefined && String(value) !== property.observedValue) {
        throw new Error(`${definition.name} decoded as ${String(value)}, hardware showed ${property.observedValue}`)
    }
    return `${definition.name} = ${String(value)}`
}

function alternativeValue(descriptor: DevicePropDesc): number | bigint | string | undefined {
    const current = descriptor.currentValueDecoded
    const enumerated = descriptor.supportedValuesDecoded?.find(value => value !== current)
    if (enumerated !== undefined) return enumerated
    if (descriptor.minimumValue === undefined || descriptor.maximumValue === undefined) return undefined
    return current === descriptor.minimumValue ? descriptor.maximumValue : descriptor.minimumValue
}

async function setProperty(simulated: SimulatedCamera): Promise<string> {
    const writable = candidateProperties(simulated).filter(
        ({ property }) => property.access !== 'get' && property.descriptor?.writable !== false
    )
    if (writable.length === 0) throw new NotOffered('no writable property was captured')
    const { definition } = writable[0]
    const descriptorResponse = await simulated.camera.send(registryOf(simulated).operations.GetDevicePropDesc, {
        DevicePropCode: definition.code,
    })
    const descriptor = descriptorResponse.data as DevicePropDesc | undefined
    if (descriptorResponse.code !== OK || !descriptor)
        throw new Error(`GetDevicePropDesc returned ${formatCode(descriptorResponse.code)}`)
    if (descriptor.getSet !== 'GET_SET') throw new NotOffered(`${definition.name} is read-only on this camera`)
    const target = alternativeValue(descriptor)
    if (target === undefined) throw new NoProfileData(`${definition.name} descriptor lists no alternative value`)

    const original = descriptor.currentValueDecoded
    let changedValue: unknown
    const failures: unknown[] = []
    try {
        await simulated.camera.set(definition, target as never)
        changedValue = await simulated.camera.get(definition)
        if (changedValue !== target)
            throw new Error(`${definition.name} read back ${String(changedValue)} after setting ${String(target)}`)
    } catch (error) {
        failures.push(error)
    }
    // Restore after any attempted write, including an accepted write whose readback failed.
    try {
        await simulated.camera.set(definition, original as never)
        const restored = await simulated.camera.get(definition)
        if (restored !== original)
            throw new Error(`${definition.name} read back ${String(restored)} after restoring ${String(original)}`)
    } catch (error) {
        failures.push(error)
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length > 1)
        throw new AggregateError(
            failures,
            failures.map(error => (error instanceof Error ? error.message : String(error))).join('; ')
        )
    return `${definition.name} ${String(original)} -> ${String(changedValue)} -> ${String(original)}`
}

async function capture(simulated: SimulatedCamera): Promise<string> {
    const hasMedia = simulated.profile.exchanges.some(
        exchange => exchange.operation === '0x1009' && exchange.response.data
    )
    if (
        hasMedia &&
        simulated.tier === 'simulated' &&
        !simulated.profile.events.length &&
        !simulated.profile.quirks.some(quirk => quirk.behaviour.kind === 'emit-event')
    )
        throw new NoProfileData('captured image bytes have no captured object event to identify the new image')
    const result = await simulated.camera.captureImage({
        includeInfo: hasMedia || simulated.tier === 'hardware',
        includeData: hasMedia || simulated.tier === 'hardware',
    })
    if (!result.data?.length)
        throw new NoProfileData(
            'capture command completed without returned image media; command acceptance is not a completed capture'
        )
    if (!result.info)
        throw new NoProfileData('image bytes returned without object metadata to verify the complete transfer')
    if (result.info.objectCompressedSize !== result.data.length)
        throw new Error(`image transfer returned ${result.data.length}/${result.info.objectCompressedSize} bytes`)
    return `${result.data.length} captured image bytes returned through darkgrade`
}

/** Validates JPEG framing and dimensions, without asserting visual focus or exposure. */
function jpegDimensions(bytes: Uint8Array): string {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
        throw new Error('live view returned an incomplete JPEG frame')
    let dimensions: string | undefined
    for (let offset = 2; offset + 3 < bytes.length;) {
        if (bytes[offset++] !== 0xff) break
        while (bytes[offset] === 0xff) offset++
        const marker = bytes[offset++]
        if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue
        if (offset + 2 > bytes.length) break
        const length = (bytes[offset] << 8) | bytes[offset + 1]
        if (length < 2 || offset + length > bytes.length) break
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            const height = (bytes[offset + 3] << 8) | bytes[offset + 4]
            const width = (bytes[offset + 5] << 8) | bytes[offset + 6]
            const components = bytes[offset + 7]
            if (!components || length !== 8 + 3 * components || !width || !height) break
            dimensions = `${width}x${height}`
        }
        if (marker === 0xda && dimensions && length >= 8 && offset + length < bytes.length - 2) return dimensions
        offset += length
    }
    throw new Error('live-view JPEG has no complete frame dimensions and image scan')
}

async function liveView(simulated: SimulatedCamera): Promise<string> {
    const frame = await simulated.camera.captureLiveView({ includeInfo: false, includeData: true })
    if (!frame.data?.length) throw new Error('live view returned no image data')
    return `${jpegDimensions(frame.data)} JPEG frame; ${frame.data.length} bytes`
}

async function events(simulated: SimulatedCamera): Promise<string> {
    refuseReplayOnHardware(simulated)
    const recorded = simulated.profile.events[0]
    if (!recorded) throw new NoProfileData('no captured events')
    const definition = (Object.values(registryOf(simulated).events) as EventDefinition[]).find(
        event => event.code === parseCode(recorded.code)
    )
    if (!definition) throw new NotOffered(`darkgrade has no definition for event ${recorded.code}`)
    if (recorded.parameters === undefined) throw new NoProfileData('captured event parameters are unknown')
    if (recorded.parameters.length !== definition.parameters.length)
        throw new NotOffered(`darkgrade cannot express the captured ${definition.name} parameters`)
    const expected: Record<string, unknown> = {}
    definition.parameters.forEach((parameter, index) => {
        if (!parameter) return
        const bytes = new Uint8Array(4)
        new DataView(bytes.buffer).setUint32(0, parseCode(recorded.parameters![index]), true)
        expected[parameter.name] = simulated.camera.getInstance().resolveCodec(parameter.codec).decode(bytes).value
    })
    const trigger = simulated.profile.exchanges.find(exchange => exchange.operation === recorded.afterOperation)
    if (!trigger) throw new NoProfileData(`no captured exchange for ${recorded.afterOperation} to trigger the event`)
    let settle: (parameters: unknown) => void = () => undefined
    const delivered = new Promise<unknown>(resolve => {
        settle = resolve
    })
    const listener = (parameters: unknown) => settle(parameters)
    const timer = setTimeout(() => settle(undefined), Math.min(1000, Math.max(1, simulated.timeoutMilliseconds / 2)))
    simulated.camera.on(definition, listener)
    try {
        const outcome = await replayExchange(simulated, trigger, { sessionEstablished: true })
        if (outcome !== 'matched') throw new NoProfileData(`could not replay the triggering exchange (${outcome})`)
        const parameters = await delivered
        if (parameters === undefined) throw new NoProfileData(`${definition.name} was not delivered`)
        if (!isDeepStrictEqual(parameters, expected))
            throw new Error(`${definition.name} decoded parameters differ from the captured event`)
        return `${definition.name} ${JSON.stringify(parameters)}`
    } finally {
        clearTimeout(timer)
        simulated.camera.off(definition, listener)
    }
}

type ReplayOutcome =
    'matched' | 'undefined' | 'inexpressible' | 'parameters-unknown' | 'blocked' | `mismatch: ${string}`

async function replayExchange(
    simulated: SimulatedCamera,
    exchange: RecordedExchange,
    context: { sessionEstablished: boolean } = { sessionEstablished: false }
): Promise<ReplayOutcome> {
    const definition = findOperation(simulated, parseCode(exchange.operation))
    if (!definition) return 'undefined'
    const parameterDefinitions = definition.operationParameters.filter(parameter => parameter !== undefined)
    if (exchange.parameters === undefined) return 'parameters-unknown'
    if ((exchange.response.parameters?.length ?? 0) > 0) return 'inexpressible'
    if (definition.dataDirection === 'in' && exchange.dataFromHost === undefined) return 'parameters-unknown'

    const parameters: Record<string, unknown> = {}
    const recorded = (exchange.parameters ?? []).map(parseCode)
    if (recorded.length > parameterDefinitions.length) return 'inexpressible'
    try {
        recorded.forEach((word, index) => {
            const parameter = parameterDefinitions[index]
            const codec = simulated.camera.getInstance().resolveCodec(parameter.codec)
            const bytes = new Uint8Array(4)
            new DataView(bytes.buffer).setUint32(0, word, true)
            const decoded = codec.decode(bytes).value
            const encoded = codec.encode(decoded)
            const slot = new Uint8Array(4)
            if (encoded.length > 4) throw new Error('parameter does not fit a PTP slot')
            slot.set(encoded)
            if (!isDeepStrictEqual(slot, bytes)) throw new Error('parameter cannot round-trip through its definition')
            parameters[parameter.name] = decoded
        })
    } catch {
        return 'inexpressible'
    }

    const data = exchange.dataFromHost !== undefined ? parseBytes(exchange.dataFromHost) : undefined
    const response = await simulated.camera.send(definition, parameters as never, data)
    const expected = parseCode(exchange.response.code)
    if (response.code === expected) {
        if (response.code === OK && exchange.operation === '0x1002') context.sessionEstablished = true
        if ((response.code === OK && exchange.operation === '0x1003') || response.code === 0x2003)
            context.sessionEstablished = false
        if (exchange.response.data !== undefined) {
            const bytes = parseBytes(exchange.response.data)
            const codec = definition.dataCodec && simulated.camera.getInstance().resolveCodec(definition.dataCodec)
            const decoded = codec ? codec.decode(bytes).value : bytes
            if (!('data' in response) || !isDeepStrictEqual(response.data, decoded))
                return 'mismatch: response data differs from the captured dataset'
        }
        return 'matched'
    }
    // A profile aggregates observations, not necessarily a chronological session trace.
    if (response.code === 0x2003 && !context.sessionEstablished) return 'blocked'
    if (response.code !== 0x2003 && gateResponses(simulated.profile).has(response.code)) return 'blocked'
    return `mismatch: ${formatCode(response.code)} != ${exchange.response.code}`
}

/** Responses a `requires-operations` quirk gives while its unlocking operations have not succeeded. */
function gateResponses(profile: CameraProfile): Set<number> {
    return new Set(
        profile.quirks.flatMap(({ behaviour }) =>
            behaviour.kind === 'requires-operations' ? [parseCode(behaviour.response)] : []
        )
    )
}

function describeExchange(exchange: RecordedExchange): string {
    return `${exchange.operation}${exchange.parameters ? ` [${exchange.parameters.join(',')}]` : ''}`
}

/** Vendor opcodes (0x9000-0x9fff) the profile documents, checked against darkgrade's registry for that camera. */
async function vendorOperationDefinitions(simulated: SimulatedCamera): Promise<string> {
    const codes = new Set(
        [
            ...(simulated.profile.deviceInfo?.operationsSupported ?? []),
            ...simulated.profile.exchanges.map(exchange => exchange.operation),
        ]
            .map(parseCode)
            .filter(code => code >= 0x9000 && code <= 0x9fff)
    )
    if (codes.size === 0) throw new NoProfileData('the profile documents no vendor operations')
    const missing = [...codes].filter(code => !findOperation(simulated, code)).map(code => formatCode(code))
    const defined = codes.size - missing.length
    if (missing.length === 0) return `all ${codes.size} vendor operations defined`
    throw new NotOffered(`${defined}/${codes.size} defined; no darkgrade definition for ${missing.join(' ')}`)
}

async function recordedExchanges(simulated: SimulatedCamera): Promise<string> {
    refuseReplayOnHardware(simulated)
    if (simulated.profile.exchanges.length === 0) throw new NoProfileData('no captured exchanges')
    // Recorded OpenSession belongs at the start of its own connection, not after the session capability.
    // Vendor disconnect first stops polling; missing teardown bytes are outside the recorded exchange proof.
    await simulated.camera.disconnect().catch(() => undefined)
    const instance = simulated.camera.getInstance()
    await instance.transport.disconnect()
    await instance.transport.connect(simulated.device)
    instance.sessionId = 0
    const outcomes = new Map<string, string[]>()
    const context = { sessionEstablished: false }
    for (const exchange of simulated.profile.exchanges) {
        let outcome: string
        try {
            outcome = await replayExchange(simulated, exchange, context)
        } catch (error) {
            outcome = `mismatch: ${error instanceof Error ? error.message : String(error)}`
        }
        const key = outcome.startsWith('mismatch') ? 'mismatch' : outcome
        outcomes.set(key, [
            ...(outcomes.get(key) ?? []),
            `${describeExchange(exchange)}${key === 'mismatch' ? ` (${outcome})` : ''}`,
        ])
    }

    const count = (key: string) => outcomes.get(key)?.length ?? 0
    const summary = [
        `${count('matched')}/${simulated.profile.exchanges.length} replayed through darkgrade definitions`,
        count('undefined') && `no darkgrade definition: ${outcomes.get('undefined')!.join(' ')}`,
        count('inexpressible') && `parameters not expressible: ${outcomes.get('inexpressible')!.join(' ')}`,
        count('parameters-unknown') && `${count('parameters-unknown')} without recorded parameters`,
        count('blocked') && `blocked by missing session or quirk prerequisites: ${outcomes.get('blocked')!.join(' ')}`,
        count('mismatch') && `mismatched: ${outcomes.get('mismatch')!.join(' ')}`,
    ]
        .filter(Boolean)
        .join('; ')

    if (count('mismatch')) throw new Error(summary)
    if (count('undefined') || count('inexpressible'))
        throw new NotOffered(`darkgrade cannot replay every captured exchange: ${summary}`)
    if (count('parameters-unknown') || count('blocked')) throw new NoProfileData(summary)
    if (count('matched') === simulated.profile.exchanges.length) return summary
    throw new NoProfileData(summary)
}

/** Capabilities marked `needsSession` only run after Camera.connect() succeeded, as in real use. */
export const CAPABILITIES = [
    { id: 'session', label: 'Connect / session', run: connectSession, needsSession: false },
    { id: 'device-info', label: 'DeviceInfo', run: readDeviceInfo, needsSession: false },
    { id: 'list-properties', label: 'List properties', run: listProperties, needsSession: true },
    { id: 'get-property', label: 'Get property', run: getProperty, needsSession: true },
    { id: 'set-property', label: 'Set property', run: setProperty, needsSession: true },
    { id: 'capture', label: 'Capture', run: capture, needsSession: true },
    { id: 'live-view', label: 'Live view', run: liveView, needsSession: true },
    { id: 'events', label: 'Events', run: events, needsSession: true },
    { id: 'recorded-exchanges', label: 'Recorded exchanges', run: recordedExchanges, needsSession: false },
    { id: 'vendor-operations', label: 'Vendor op definitions', run: vendorOperationDefinitions, needsSession: false },
] as const

/** Called as each capability starts and finishes, for live progress reporting. */
export interface CapabilityProgress {
    onStart?: (capability: string) => void
    onResult?: (capability: string, result: CapabilityResult, durationMilliseconds: number) => void
}

/** Runs every capability in order; session-dependent ones inherit a session that did not pass. */
export async function evaluateCapabilities(
    simulated: SimulatedCamera,
    progress: CapabilityProgress = {}
): Promise<Record<string, CapabilityResult>> {
    const results: Record<string, CapabilityResult> = {}
    let stoppedAfterTimeout = false
    for (const capability of CAPABILITIES) {
        const startedAt = Date.now()
        progress.onStart?.(capability.id)
        const session = results.session
        if (stoppedAfterTimeout) {
            results[capability.id] = {
                status: 'no-data',
                detail: 'not run after an earlier capability timed out; no overlapping camera operation was started',
            }
        } else if (capability.needsSession && session && session.status !== 'pass') {
            const status = session.status === 'fail' ? 'fail' : session.status
            results[capability.id] = { status, detail: `requires a session: ${session.detail}` }
        } else {
            results[capability.id] = await evaluateCapability(simulated, capability.run, () => {
                stoppedAfterTimeout = true
            })
        }
        progress.onResult?.(capability.id, results[capability.id], Date.now() - startedAt)
    }
    return results
}

function withTimeout<T>(promise: Promise<T>, timeoutMilliseconds: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new TimedOut(`timed out after ${timeoutMilliseconds} ms`)), timeoutMilliseconds)
    })
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Runs one capability and classifies the outcome. */
async function evaluateCapability(
    simulated: SimulatedCamera,
    run: (simulated: SimulatedCamera) => Promise<string>,
    onTimeout: () => void
): Promise<CapabilityResult> {
    const { transport } = simulated
    const missingBefore = transport.missingData.length
    const responsesBefore = transport.responseCodes.length
    try {
        const detail = await withTimeout(run(simulated), simulated.timeoutMilliseconds)
        if (run !== recordedExchanges && transport.missingData.length > missingBefore)
            throw new NoProfileData(transport.missingData[missingBefore].message)
        const lastResponse = transport.responseCodes.slice(responsesBefore).at(-1)
        if (
            run !== recordedExchanges &&
            run !== vendorOperationDefinitions &&
            lastResponse !== undefined &&
            lastResponse !== OK
        )
            throw new Error(`operation completed after camera refusal ${formatCode(lastResponse)}`)
        return { status: 'pass', detail }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof TimedOut) {
            onTimeout()
            if (simulated.tier === 'simulated')
                await simulated.camera
                    .getInstance()
                    .transport.disconnect()
                    .catch(() => undefined)
        }
        if (error instanceof NoProfileData) return { status: 'no-data', detail: message }
        if (run !== recordedExchanges && transport.missingData.length > missingBefore) {
            return { status: 'no-data', detail: transport.missingData[missingBefore].message }
        }
        if (error instanceof NotOffered) return { status: 'unsupported', detail: message }
        if (error instanceof TimedOut && simulated.profile.provenance.fidelity === 'documented') {
            return { status: 'no-data', detail: `${message}; the documented mock produces no events or objects` }
        }
        const responses = transport.responseCodes.slice(responsesBefore)
        const refusal = responses.find(code => CAMERA_REPORTS_UNSUPPORTED.has(code))
        if (refusal !== undefined)
            return { status: 'unsupported', detail: `camera answered ${formatCode(refusal)}: ${message}` }
        if (error instanceof SimulatedDisconnectError) return { status: 'fail', detail: message }
        if (/not supported|only available|not implemented/i.test(message)) {
            return { status: 'unsupported', detail: `darkgrade: ${message}` }
        }
        return { status: 'fail', detail: message }
    }
}
