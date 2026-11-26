import { CanonCamera } from '@vendors/canon/canon-camera'
import type { Camera } from '@camera/index'
import { protocolAccess } from '@camera/protocol-session'
import { SonyCamera } from '@vendors/sony/sony-camera'
import { slateBuildMetadata } from '@core/telemetry'
import { type ProtocolEvidence } from '@contribute/protocol'
import { createNikonRegistry } from '@vendors/registry'
import { capturePropertyCodes } from '@vendors/capture-properties'

export interface BenchmarkCheck {
    name: string
    passed: boolean
    durationMilliseconds: number
    error?: 'operation-failed' | 'deadline' | 'cancelled'
}
export interface BenchmarkOptions {
    /** Take one photo and transfer it. Default false. */
    photo?: boolean
    /** Transfer one live-view frame. Default false. */
    liveView?: boolean
    /** 'first-contact' is the automatic read-only inventory: no capture, live view or storage mode change. */
    purpose?: 'benchmark' | 'first-contact'
    signal?: AbortSignal
    timeoutMilliseconds?: number
    maximumProperties?: number
    onProgress?: (check: BenchmarkCheck) => void
    /** Hosts can drain their bounded telemetry queue between inventory phases. */
    flushEvidence?: () => Promise<unknown>
}

/** Numeric descriptor metadata kept in the local profile only; never values or payloads. */
export interface DescriptorShape {
    property: number
    dataType: number
    writable: boolean
    form: number
    choices?: number
}

/** Whether a transport reports real hardware (`hardware`) or a simulation, as its telemetry records it. */
export const transportEvidence = (transport: object): string | undefined =>
    (transport as { telemetryEvidence?: string }).telemetryEvidence

/** The options `runCameraBenchmark` took before `photo` and `liveView`. */
export interface LegacyBenchmarkOptions extends Omit<BenchmarkOptions, 'photo' | 'liveView'> {
    capture?: boolean
    live?: boolean
}

/** @deprecated Use `runBenchmark(camera, { photo, liveView })`. */
export async function runCameraBenchmark(camera: Camera, options: LegacyBenchmarkOptions = {}) {
    const { capture, live, ...rest } = options
    return runBenchmark(camera, { ...rest, photo: capture, liveView: live })
}

/** Caller owns an idle, connected camera. Reads its full advertised inventory and bounded
 * safe numeric descriptors. Photo/live transfers remain explicit; no arbitrary vendor writes. */
export async function runBenchmark(camera: Camera, options: BenchmarkOptions = {}) {
    const firstContact = options.purpose === 'first-contact'
    const timeout = options.timeoutMilliseconds ?? 180_000
    const maximum = options.maximumProperties ?? 128
    const within = (value: number, largest: number) => Number.isSafeInteger(value) && value >= 1 && value <= largest
    if (!within(timeout, 300_000) || !within(maximum, 512)) throw new Error('Invalid benchmark bounds')
    const id = crypto.randomUUID(), started = Date.now(), deadline = started + timeout
    const session = protocolAccess(camera), instance = session.driver, vendorId = instance.vendorId ?? 0
    type BenchmarkStatus = 'started' | 'cancelled' | 'complete' | 'partial'
    const benchmarkEvidence = (status: BenchmarkStatus, checkCount: number, failures: number): ProtocolEvidence => ({
        type: 'benchmark', vendorId, benchmarkId: id, status, checks: checkCount, failures,
        ...(firstContact && { purpose: 'first-contact' as const }),
    })
    const checks: BenchmarkCheck[] = []
    const datasets: ProtocolEvidence[] = []
    const descriptorShapes: DescriptorShape[] = []
    let retainedBytes = 0, truncated = false
    const detach = instance.observeProfile(id, item => {
        const bytes = JSON.stringify(item).length
        if (datasets.length >= 8192 || retainedBytes + bytes > 2 * 1024 * 1024) {
            truncated = true
            return
        }
        datasets.push(structuredClone(item))
        retainedBytes += bytes
    })
    const flush = async () => { try { await options.flushEvidence?.() } catch { /* Local export remains available. */ } }
    await flush()
    const stopped = () => (options.signal?.aborted ? 'cancelled' : Date.now() >= deadline ? 'deadline' : undefined)
    const check = async <Result>(name: string, work: () => Promise<Result>): Promise<Result | undefined> => {
        const beginning = performance.now(), stop = stopped()
        let value: Result | undefined
        const result: BenchmarkCheck = { name, passed: false, durationMilliseconds: 0 }
        try {
            if (stop) result.error = stop
            else {
                value = await work()
                result.passed = true
            }
        } catch {
            result.error = 'operation-failed'
        }
        result.durationMilliseconds = Math.round(performance.now() - beginning)
        checks.push(result)
        try { options.onProgress?.(result) } catch { /* Reporting does not change camera cleanup. */ }
        if (!name.startsWith('property-')) await flush()
        return value
    }
    let identity: { manufacturer: string; model: string; firmware: string } | undefined
    try {
        const response = await check('identity', async () => {
            const result = await session.send(instance.registry.operations.GetDeviceInfo, {})
            if (result.code !== 0x2001 || !result.data?.model) throw new Error('Missing camera identity')
            return result.data
        })
        // Model-scoped evidence follows the identity read; snapshotting earlier left it under "Unknown".
        instance.recordProtocol(benchmarkEvidence('started', 0, 0), 0x1001)
        instance.recordStateSnapshot('benchmark', 'before-prepare')
        if (response) {
            identity = { manufacturer: response.manufacturer, model: response.model, firmware: response.deviceVersion }
            const supported = new Set(response.operationsSupportedRaw)
            const safe = capturePropertyCodes(vendorId)
            const known = new Set(Object.values(instance.registry.properties).map(item => item.code))
            let properties = response.devicePropertiesSupported.filter(code => safe.has(code))
            const vendorInventory = instance instanceof SonyCamera || instance instanceof CanonCamera || vendorId === 0x04b0
            if (!vendorInventory) {
                // Without a vendor inventory (e.g. Fujifilm), read every advertised code Slate does not
                // know, including 0xDxxx vendor codes. Known private properties stay excluded; only
                // allowlisted numeric values leave the camera session.
                properties = [...new Set(response.devicePropertiesSupported)].filter(code => safe.has(code) || !known.has(code))
            }
            if (instance instanceof SonyCamera) {
                // One authoritative inventory; legacy per-property probes can wedge newer Sonys.
                if (supported.has(0x9209))
                    await check('sony-property-inventory', () => instance.refreshPropertyStates({ preserveTransferMode: true }))
                properties = []
            } else if (instance instanceof CanonCamera) {
                if (supported.has(0x9108))
                    await check('canon-extended-inventory', async () => {
                        const result = await session.send(instance.registry.operations.CanonGetExtendedDeviceInfo, {})
                        if (result.code !== 0x2001 || !result.data) throw new Error('No Canon inventory')
                    })
                await check('canon-controls', () => instance.refreshEventProperties())
                properties = properties.filter(code => code < 0x8000)
            } else if (vendorId === 0x04b0 && supported.has(0x9439)) {
                await check('nikon-vendor-inventory', async () => {
                    const result = await session.send(createNikonRegistry(true).operations.GetVendorCodes, { Kind: 13 })
                    const bytes = result.data
                    if (result.code !== 0x2001 || !(bytes instanceof Uint8Array) || bytes.length < 4)
                        throw new Error('No vendor inventory')
                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), count = view.getUint32(0, true)
                    if (count > 4096 || bytes.length !== 4 + count * 4) throw new Error('Invalid vendor inventory')
                    const codes = [...new Set(Array.from({ length: count }, (_, index) => view.getUint32(4 + index * 4, true)))]
                    instance.recordProtocol({ type: 'inventory', vendorId, category: 'property', codes }, 0x9439)
                    for (const code of codes.filter(code => !known.has(code)))
                        instance.recordProtocol({ type: 'unknown', vendorId, category: 'property', code, advertised: true }, 0x9439)
                    properties = [...new Set([...properties, ...codes.filter(code => safe.has(code))])]
                })
            }
            for (const property of properties.slice(0, maximum)) {
                if (stopped()) {
                    truncated = true
                    break
                }
                await check(`property-0x${property.toString(16)}`, async () => {
                    const nikonExtended = vendorId === 0x04b0 && supported.has(0x943a)
                    const operation = nikonExtended ? createNikonRegistry(true).operations.GetDevicePropDescEx : instance.registry.operations.GetDevicePropDesc
                    const result = await session.send(operation, { DevicePropCode: property })
                    if (result.code !== 0x2001 || !result.data) throw new Error('Missing property descriptor')
                    const descriptor = result.data
                    descriptorShapes.push({
                        property,
                        dataType: descriptor.dataType,
                        writable: descriptor.getSet === 'GET_SET',
                        form: descriptor.formFlag,
                        ...(descriptor.supportedValuesRaw && { choices: descriptor.supportedValuesRaw.length }),
                    })
                })
            }
            if (properties.length > maximum) truncated = true
            // Sony storage needs a transfer-mode switch; first contact reads whatever is exposed without it.
            const prepareSonyStorage = instance instanceof SonyCamera && !firstContact
            await check('storage', async () => {
                try {
                    if (prepareSonyStorage) await instance.prepareStorageRead()
                    const result = await session.send(instance.registry.operations.GetStorageIDs, {})
                    if (result.code !== 0x2001 || !result.data) throw new Error('Missing storage result')
                } finally {
                    if (prepareSonyStorage) await instance.resumeShooting()
                }
            })
            if (options.photo && !firstContact)
                await check('photo-transfer', async () => {
                    if (!(await camera.takePhoto({ autofocus: false, destination: 'computer' })).data.length) throw new Error('No image transferred')
                })
            if (options.liveView && !firstContact)
                await check('live-transfer', async () => {
                    if (!(await camera.getLiveViewFrame()).jpeg.length) throw new Error('No frame transferred')
                })
        }
    } finally {
        detach()
    }
    const stop = stopped()
    const complete = !stop && !truncated && checks.every(item => item.passed)
    const status = stop === 'cancelled' ? 'cancelled' : complete ? 'complete' : 'partial'
    const summary = benchmarkEvidence(status, checks.length, checks.filter(item => !item.passed).length)
    instance.recordProtocol(summary, 0x1001)
    datasets.push(summary)
    return {
        checks,
        passed: complete,
        mediaDecoded: false,
        profile: {
            schema: 'darkgrade.camera-profile/v1',
            id,
            capturedAt: new Date(started).toISOString(),
            ...(await slateBuildMetadata()),
            vendorId,
            identity,
            transport: instance.transport.getType(),
            evidence: transportEvidence(instance.transport) === 'hardware' ? 'hardware' : 'synthetic',
            status,
            purpose: firstContact ? 'first-contact' : 'benchmark',
            scope: firstContact ? 'first-contact-read-only-inventory' : 'advertised-inventory-and-allowlisted-numeric-descriptors',
            descriptorShapes,
            hardwarePass: false,
            omitted: ['media', 'authentication', 'identity-strings', 'unknown-property-values', 'non-numeric-values'],
            datasets,
        },
    }
}
