import { Camera } from '@camera/index'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { CapabilityResult } from '@scripts/camera-profiles/support-matrix'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import {
    formatCode,
    parseBytes,
    parseCode,
    type CameraProfile,
    type RecordedExchange,
} from '@transport/simulated/camera-profile'
import { SimulatedDisconnectError, SimulatedTransport } from '@transport/simulated/simulated-transport'

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
    /** Passed to Camera.connect(); selects the physical camera on the hardware tier. */
    device?: DeviceDescriptor
    timeoutMilliseconds: number
}

export function simulateCamera(profile: CameraProfile): SimulatedCamera {
    const transport = new SimulatedTransport(profile)
    const camera = new Camera({
        transport,
        vendorId: profile.usb ? parseCode(profile.usb.vendorId) : undefined,
        logger: { renderInTerminal: false, captureConsole: false, expanded: false },
    })
    return { profile, camera, transport, tier: 'simulated', timeoutMilliseconds: SIMULATED_TIMEOUT_MILLISECONDS }
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
    await simulated.camera.connect(simulated.device)
    return 'Camera.connect() completed'
}

async function readDeviceInfo(simulated: SimulatedCamera): Promise<string> {
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
    return `${identity}; ${deviceInfo.operationsSupportedRaw.length} operations, ${deviceInfo.devicePropertiesSupported.length} properties`
}

async function listProperties(simulated: SimulatedCamera): Promise<string> {
    const states = await simulated.camera.getStandardPropertyStates()
    return `${states.length} standard properties decoded`
}

/** Profile properties darkgrade has a definition for, preferring ones with captured descriptors. */
function candidateProperties(simulated: SimulatedCamera) {
    const properties = simulated.profile.properties.flatMap(property => {
        const definition = findProperty(simulated, parseCode(property.code))
        return definition ? [{ property, definition }] : []
    })
    if (properties.length === 0) throw new NoProfileData('no captured properties that darkgrade defines')
    return properties.sort((left, right) => Number(!!right.property.descriptor) - Number(!!left.property.descriptor))
}

async function getProperty(simulated: SimulatedCamera): Promise<string> {
    const [{ property, definition }] = candidateProperties(simulated) as [ReturnType<typeof candidateProperties>[0]]
    const value = await simulated.camera.get(definition)
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
    const writable = candidateProperties(simulated).filter(({ property }) => property.access !== 'get')
    if (writable.length === 0) throw new NotOffered('no writable property was captured')
    const { definition } = writable[0]
    const descriptorResponse = await simulated.camera.send(registryOf(simulated).operations.GetDevicePropDesc, {
        DevicePropCode: definition.code,
    })
    const descriptor = descriptorResponse.data as DevicePropDesc | undefined
    if (!descriptor) throw new Error(`GetDevicePropDesc returned ${formatCode(descriptorResponse.code)}`)
    if (descriptor.getSet !== 'GET_SET') throw new NotOffered(`${definition.name} is read-only on this camera`)
    const target = alternativeValue(descriptor)
    if (target === undefined) throw new NoProfileData(`${definition.name} descriptor lists no alternative value`)

    const original = descriptor.currentValueDecoded
    await simulated.camera.set(definition, target as never)
    const readBack = await simulated.camera.get(definition)
    if (readBack !== target)
        throw new Error(`${definition.name} read back ${String(readBack)} after setting ${String(target)}`)
    await simulated.camera.set(definition, original as never)
    const restored = await simulated.camera.get(definition)
    if (restored !== original)
        throw new Error(`${definition.name} read back ${String(restored)} after restoring ${String(original)}`)
    return `${definition.name} ${String(original)} -> ${String(target)} -> ${String(restored)}`
}

async function capture(simulated: SimulatedCamera): Promise<string> {
    await simulated.camera.captureImage({ includeInfo: false, includeData: false })
    return 'capture accepted'
}

async function liveView(simulated: SimulatedCamera): Promise<string> {
    const frame = await simulated.camera.captureLiveView({ includeInfo: false, includeData: true })
    if (!frame.data?.length) throw new Error('live view returned no image data')
    return `${frame.data.length} byte frame`
}

async function events(simulated: SimulatedCamera): Promise<string> {
    refuseReplayOnHardware(simulated)
    const recorded = simulated.profile.events[0]
    if (!recorded) throw new NoProfileData('no captured events')
    const definition = Object.values(registryOf(simulated).events).find(
        event => event.code === parseCode(recorded.code)
    )
    if (!definition) throw new NotOffered(`darkgrade has no definition for event ${recorded.code}`)
    const trigger = simulated.profile.exchanges.find(exchange => exchange.operation === recorded.afterOperation)
    if (!trigger) throw new NoProfileData(`no captured exchange for ${recorded.afterOperation} to trigger the event`)

    const delivered = new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${definition.name} was not delivered`)), 1_000)
        simulated.camera.on(definition, parameters => {
            clearTimeout(timer)
            resolve(`${definition.name} ${JSON.stringify(parameters)}`)
        })
    })
    const outcome = await replayExchange(simulated, trigger)
    if (outcome !== 'matched') throw new NoProfileData(`could not replay the triggering exchange (${outcome})`)
    return delivered
}

type ReplayOutcome =
    'matched' | 'undefined' | 'inexpressible' | 'parameters-unknown' | 'blocked' | `mismatch: ${string}`

async function replayExchange(simulated: SimulatedCamera, exchange: RecordedExchange): Promise<ReplayOutcome> {
    const definition = findOperation(simulated, parseCode(exchange.operation))
    if (!definition) return 'undefined'
    const parameterDefinitions = definition.operationParameters.filter(parameter => parameter !== undefined)
    if (!exchange.parameters && parameterDefinitions.some(parameter => parameter.required)) return 'parameters-unknown'
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
            parameters[parameter.name] = codec.decode(bytes).value
        })
    } catch {
        return 'inexpressible'
    }

    const data = exchange.dataFromHost !== undefined ? parseBytes(exchange.dataFromHost) : undefined
    const response = await simulated.camera.send(definition, parameters as never, data)
    const expected = parseCode(exchange.response.code)
    if (response.code === expected) return 'matched'
    if (gateResponses(simulated.profile).has(response.code)) return 'blocked'
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
    const outcomes = new Map<string, string[]>()
    for (const exchange of simulated.profile.exchanges) {
        let outcome: string
        try {
            outcome = await replayExchange(simulated, exchange)
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
        count('blocked') && `blocked by an unmet quirk prerequisite: ${outcomes.get('blocked')!.join(' ')}`,
        count('mismatch') && `mismatched: ${outcomes.get('mismatch')!.join(' ')}`,
    ]
        .filter(Boolean)
        .join('; ')

    if (count('mismatch')) throw new Error(summary)
    if (count('matched')) return summary
    if (count('undefined') || count('inexpressible') || count('blocked')) throw new NotOffered(summary)
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

/** Runs every capability in order; session-dependent ones inherit a session that did not pass. */
export async function evaluateCapabilities(simulated: SimulatedCamera): Promise<Record<string, CapabilityResult>> {
    const results: Record<string, CapabilityResult> = {}
    for (const capability of CAPABILITIES) {
        const session = results.session
        if (capability.needsSession && session && session.status !== 'pass') {
            const status = session.status === 'fail' ? 'fail' : session.status
            results[capability.id] = { status, detail: `requires a session: ${session.detail}` }
            continue
        }
        results[capability.id] = await evaluateCapability(simulated, capability.run)
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
    run: (simulated: SimulatedCamera) => Promise<string>
): Promise<CapabilityResult> {
    const { transport } = simulated
    const missingBefore = transport.missingData.length
    const responsesBefore = transport.responseCodes.length
    try {
        return { status: 'pass', detail: await withTimeout(run(simulated), simulated.timeoutMilliseconds) }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof NoProfileData) return { status: 'no-data', detail: message }
        if (transport.missingData.length > missingBefore) {
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
        // Documented mocks lack most state (property dumps, objects, complete operation lists), so only
        // a disagreement with a documented exchange counts as a failure for them.
        if (simulated.profile.provenance.fidelity === 'documented' && run !== recordedExchanges) {
            return { status: 'no-data', detail: `incomplete documented mock: ${message}` }
        }
        return { status: 'fail', detail: message }
    }
}
