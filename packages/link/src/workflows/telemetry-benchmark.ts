import { CanonCamera } from '@camera/canon-camera'
import type { Camera } from '@camera/index'
import { SonyCamera } from '@camera/sony-camera'
import { linkBuildMetadata } from '@core/telemetry'
import { type ProtocolEvidence } from '@darkgrade/contribute/protocol'
import { createNikonRegistry } from '@ptp/registry'
import { capturePropertyCodes } from '@vendors/capture-properties'

export interface BenchmarkCheck {
    name: string
    passed: boolean
    durationMilliseconds: number
    error?: 'operation-failed' | 'deadline' | 'cancelled'
}
export interface BenchmarkOptions {
    capture?: boolean
    live?: boolean
    signal?: AbortSignal
    timeoutMilliseconds?: number
    maximumProperties?: number
    onProgress?: (check: BenchmarkCheck) => void
}

/** Caller owns an idle, connected camera. Reads its full advertised inventory and bounded
 * safe numeric descriptors. Photo/live transfers remain explicit; no arbitrary vendor writes. */
export async function runCameraBenchmark(camera: Camera, options: BenchmarkOptions = {}) {
    const timeout = options.timeoutMilliseconds ?? 180_000
    const maximum = options.maximumProperties ?? 128
    if (
        !Number.isSafeInteger(timeout) ||
        timeout < 1 ||
        timeout > 300_000 ||
        !Number.isSafeInteger(maximum) ||
        maximum < 1 ||
        maximum > 512
    )
        throw new Error('Invalid benchmark bounds')
    const id = crypto.randomUUID(),
        started = Date.now(),
        deadline = started + timeout
    const instance = camera.getInstance(),
        vendorId = instance.vendorId ?? 0
    const checks: BenchmarkCheck[] = []
    const datasets: ProtocolEvidence[] = []
    let retainedBytes = 0,
        truncated = false
    const detach = instance.observeProfile(id, item => {
        const bytes = JSON.stringify(item).length
        if (datasets.length >= 8192 || retainedBytes + bytes > 2 * 1024 * 1024) {
            truncated = true
            return
        }
        datasets.push(structuredClone(item))
        retainedBytes += bytes
    })
    instance.recordProtocol(
        { type: 'benchmark', vendorId, benchmarkId: id, status: 'started', checks: 0, failures: 0 },
        0x1001
    )
    const stopped = () => (options.signal?.aborted ? 'cancelled' : Date.now() >= deadline ? 'deadline' : undefined)
    const check = async <Result>(name: string, work: () => Promise<Result>): Promise<Result | undefined> => {
        const beginning = performance.now(),
            stop = stopped()
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
        try {
            options.onProgress?.(result)
        } catch {
            /* Reporting does not change camera cleanup. */
        }
        return value
    }
    let identity: { manufacturer: string; model: string; firmware: string } | undefined
    try {
        const response = await check('identity', async () => {
            const result = await camera.send(instance.registry.operations.GetDeviceInfo, {})
            if (result.code !== 0x2001 || !result.data?.model) throw new Error('Missing camera identity')
            return result.data
        })
        if (response) {
            identity = { manufacturer: response.manufacturer, model: response.model, firmware: response.deviceVersion }
            const supported = new Set(response.operationsSupportedRaw)
            const safe = capturePropertyCodes(vendorId)
            let properties = response.devicePropertiesSupported.filter(code => safe.has(code))
            if (instance instanceof SonyCamera) {
                // One authoritative inventory; legacy per-property probes can wedge newer Sonys.
                if (supported.has(0x9209))
                    await check('sony-property-inventory', () =>
                        instance.refreshPropertyStates({ preserveTransferMode: true })
                    )
                properties = []
            } else if (instance instanceof CanonCamera) {
                if (supported.has(0x9108))
                    await check('canon-extended-inventory', async () => {
                        const result = await camera.send(instance.registry.operations.CanonGetExtendedDeviceInfo, {})
                        if (result.code !== 0x2001 || !result.data) throw new Error('No Canon inventory')
                    })
                await check('canon-controls', () => instance.refreshEventProperties())
                properties = properties.filter(code => code < 0x8000)
            } else if (vendorId === 0x04b0 && supported.has(0x9439)) {
                await check('nikon-vendor-inventory', async () => {
                    const result = await camera.send(createNikonRegistry(true).operations.GetVendorCodes, { Kind: 13 })
                    const bytes = result.data
                    if (result.code !== 0x2001 || !(bytes instanceof Uint8Array) || bytes.length < 4)
                        throw new Error('No vendor inventory')
                    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
                        count = view.getUint32(0, true)
                    if (count > 4096 || bytes.length !== 4 + count * 4) throw new Error('Invalid vendor inventory')
                    const codes = [
                        ...new Set(Array.from({ length: count }, (_, index) => view.getUint32(4 + index * 4, true))),
                    ]
                    instance.recordProtocol({ type: 'inventory', vendorId, category: 'property', codes }, 0x9439)
                    const known = new Set(Object.values(instance.registry.properties).map(item => item.code))
                    for (const code of codes)
                        if (!known.has(code))
                            instance.recordProtocol(
                                { type: 'unknown', vendorId, category: 'property', code, advertised: true },
                                0x9439
                            )
                    properties = [...new Set([...properties, ...codes.filter(code => safe.has(code))])]
                })
            }
            for (const property of properties.slice(0, maximum)) {
                if (stopped()) {
                    truncated = true
                    break
                }
                await check(`property-0x${property.toString(16)}`, async () => {
                    const operation =
                        vendorId === 0x04b0 && supported.has(0x943a)
                            ? createNikonRegistry(true).operations.GetDevicePropDescEx
                            : instance.registry.operations.GetDevicePropDesc
                    const result = await camera.send(operation, { DevicePropCode: property })
                    if (result.code !== 0x2001 || !result.data) throw new Error('Missing property descriptor')
                })
            }
            if (properties.length > maximum) truncated = true
            await check('storage', async () => {
                const result = await camera.send(instance.registry.operations.GetStorageIDs, {})
                if (result.code !== 0x2001 || !result.data) throw new Error('Missing storage result')
            })
            if (options.capture)
                await check('photo-transfer', async () => {
                    const image = await camera.captureImage({ includeData: true, autofocus: false })
                    if (!image.data?.length) throw new Error('No image transferred')
                })
            if (options.live)
                await check('live-transfer', async () => {
                    const frame = await camera.captureLiveView({ includeData: true })
                    if (!frame.data?.length) throw new Error('No frame transferred')
                })
        }
    } finally {
        detach()
    }
    const stop = stopped()
    const complete = !stop && !truncated && checks.every(item => item.passed)
    const status = stop === 'cancelled' ? 'cancelled' : complete ? 'complete' : 'partial'
    const summary: ProtocolEvidence = {
        type: 'benchmark',
        vendorId,
        benchmarkId: id,
        status,
        checks: checks.length,
        failures: checks.filter(item => !item.passed).length,
    }
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
            ...(await linkBuildMetadata()),
            vendorId,
            identity,
            transport: instance.transport.getType(),
            evidence:
                (instance.transport as typeof instance.transport & { telemetryEvidence?: string }).telemetryEvidence ===
                'hardware'
                    ? 'hardware'
                    : 'synthetic',
            status,
            scope: 'advertised-inventory-and-allowlisted-numeric-descriptors',
            hardwarePass: false,
            omitted: ['media', 'authentication', 'identity-strings', 'unknown-property-values', 'non-numeric-values'],
            datasets,
        },
    }
}
