import { GenericCamera } from '@camera/generic-camera'
import { Camera } from '@camera/index'
import { SonyCamera } from '@camera/sony-camera'
import { Logger } from '@core/logger'
import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { NikonEventListCodec } from '@ptp/datasets/vendors/nikon/nikon-event-list-dataset'
import { SDIExtDevicePropInfoCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { createCanonRegistry, createNikonRegistry, createSonyRegistry } from '@ptp/registry'
import type { OperationDefinition } from '@ptp/types/operation'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { recordPtpTransport, type CapturedPtpTransaction } from '@transport/ptp-trace'
import { capturePropertyCodes, captureRegistry } from '@vendors/capture-properties'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'
export { capturePropertyCodes } from '@vendors/capture-properties'

type TraceTransaction = Omit<CapturedPtpTransaction, 'dataFromHost' | 'response'> & {
    dataFromHost?: string
    response: { code: number; parameters: number[]; data?: string }
    redactions?: string[]
}
export interface ProfileObservation {
    kind: 'canon-event-record' | 'sony-property-descriptor'
    operation: number
    transactionId: number
    property: number
    code?: number
    data: string
}
export interface ProfileCaptureOptions {
    vendorId: number
    productId: number
    serialNumber?: string
    revision: string
    initialize?: boolean
    liveView?: boolean
    maxProperties?: number
    timeoutSeconds?: number
}
const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
/** Empty only the original DeviceInfo serial field, leaving every other byte unchanged. */
export function redactDeviceInfoSerial(data: Uint8Array): Uint8Array {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const stringEnd = (offset: number) => {
        if (offset >= data.length) throw new Error('Truncated DeviceInfo string')
        const end = offset + 1 + data[offset] * 2
        if (end > data.length) throw new Error('Truncated DeviceInfo string')
        return end
    }
    let offset = stringEnd(8) + 2
    for (let array = 0; array < 5; array++) {
        if (offset + 4 > data.length) throw new Error('Truncated DeviceInfo array')
        offset += 4 + view.getUint32(offset, true) * 2
        if (offset > data.length) throw new Error('Truncated DeviceInfo array')
    }
    for (let field = 0; field < 3; field++) offset = stringEnd(offset)
    if (stringEnd(offset) !== data.length) throw new Error('Unexpected DeviceInfo trailer')
    const result = new Uint8Array(offset + 1)
    result.set(data.subarray(0, offset))
    return result
}

/** These vendor datasets contain only protocol versions and counted numeric code lists. */
function numericCapabilityPayload(data: Uint8Array, vendorId: number, operation: number): boolean {
    if (vendorId === 0x04b0 && (operation === 0x941c || operation === 0x90c7)) {
        const codec =
            operation === 0x941c
                ? new NikonEventDataCodec(createNikonRegistry(true))
                : new NikonEventListCodec(createNikonRegistry(true))
        if (codec.decode(data).bytesRead !== data.length) throw new Error('Unexpected Nikon event trailer')
        return true
    }
    const format =
        vendorId === 0x04a9 && operation === 0x9108
            ? { offset: 4, widths: [4, 4, 4] }
            : vendorId === 0x054c && operation === 0x9202
              ? { offset: 2, widths: [2, 2] }
              : vendorId === 0x04b0 && operation === 0x9439
                ? { offset: 0, widths: [4] }
                : vendorId === 0x04b0 && operation === 0x90ca
                  ? { offset: 0, widths: [2] }
                  : undefined
    if (!format) return false
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = format.offset
    for (const width of format.widths) {
        if (offset + 4 > data.length) throw new Error('Truncated capability count')
        const count = view.getUint32(offset, true)
        if (count > 4096) throw new Error('Capability count exceeds capture bound')
        offset += 4 + count * width
        if (offset > data.length) throw new Error('Truncated capability array')
    }
    if (offset !== data.length) throw new Error('Unexpected capability trailer')
    return true
}

/** A serial-free, deliberately scoped snapshot. Omitted payloads remain visibly incomplete. */
export function sanitizeProfileTransaction(
    transaction: CapturedPtpTransaction,
    vendorId: number,
    observations: ProfileObservation[]
): TraceTransaction {
    const { dataFromHost, response, ...request } = transaction
    const result: TraceTransaction = { ...request, response: { code: response.code, parameters: response.parameters } }
    const safe = capturePropertyCodes(vendorId)
    const property = transaction.parameters[0]
    if (vendorId === 0x054c && transaction.operation === 0x9201) {
        const standardHandshake =
            transaction.parameters.length === 3 &&
            [1, 2, 3].includes(property) &&
            transaction.parameters[1] === 0 &&
            transaction.parameters[2] === 0 &&
            response.code === 0x2001 &&
            response.parameters.length === 0 &&
            !dataFromHost?.length &&
            !response.data?.length
        if (standardHandshake) return result
        return {
            ...result,
            parameters: [],
            response: { code: response.code, parameters: [] },
            redactions: ['authentication-payload'],
        }
    }
    const propertyOperation = [0x1014, 0x1015, 0x1016, 0x943a, 0x943b, 0x943c, 0x9251].includes(transaction.operation)
    if (response.data && transaction.operation === 0x1001 && response.code === 0x2001) {
        result.response.data = hex(redactDeviceInfoSerial(response.data))
        result.redactions = ['device-serial']
        return result
    }
    if (
        response.data &&
        response.code === 0x2001 &&
        numericCapabilityPayload(response.data, vendorId, transaction.operation)
    ) {
        result.response.data = hex(response.data)
        return result
    }
    if (propertyOperation && safe.has(property)) {
        if (response.data && response.code === 0x2001 && [0x1014, 0x943a, 0x9251].includes(transaction.operation)) {
            const codec =
                transaction.operation === 0x9251
                    ? new SDIExtDevicePropInfoCodec(createSonyRegistry(true))
                    : new DevicePropDescCodec(captureRegistry(vendorId), transaction.operation === 0x943a)
            const decoded = codec.decode(response.data)
            if (
                decoded.value.devicePropertyCode !== property ||
                decoded.value.dataType < 1 ||
                decoded.value.dataType > 10 ||
                decoded.bytesRead !== response.data.length
            )
                throw new Error('Property descriptor is not a complete numeric control')
        } else if ((response.data?.length ?? 0) > 16 || (dataFromHost?.length ?? 0) > 16)
            throw new Error('Scalar property payload exceeds capture scope')
        if (response.data) result.response.data = hex(response.data)
        if (dataFromHost) result.dataFromHost = hex(dataFromHost)
        return result
    }
    if (response.data && response.code === 0x2001 && vendorId === 0x04a9 && transaction.operation === 0x9116) {
        const bytes = response.data
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        for (let offset = 0; offset + 8 <= bytes.length;) {
            const size = view.getUint32(offset, true)
            if (size <= 8) break
            if (size < 12 || offset + size > bytes.length) throw new Error('Truncated Canon event record')
            const code = view.getUint32(offset + 4, true)
            const property = view.getUint32(offset + 8, true)
            if ((code === 0xc189 || code === 0xc18a) && safe.has(property))
                observations.push({
                    kind: 'canon-event-record',
                    operation: transaction.operation,
                    transactionId: transaction.transactionId,
                    code,
                    property,
                    data: hex(bytes.subarray(offset, offset + size)),
                })
            offset += size
        }
    }
    if (response.data && response.code === 0x2001 && vendorId === 0x054c && transaction.operation === 0x9209) {
        const bytes = response.data
        if (bytes.length < 8) throw new Error('Truncated Sony inventory header')
        const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
        if (count > 4096) throw new Error('Sony inventory count exceeds capture bound')
        const codec = new SDIExtDevicePropInfoCodec(createSonyRegistry(true))
        let offset = 8
        for (let index = 0; index < count; index++) {
            const decoded = codec.decode(bytes, offset)
            const property = decoded.value.devicePropertyCode
            if (safe.has(property) && decoded.value.dataType >= 1 && decoded.value.dataType <= 10)
                observations.push({
                    kind: 'sony-property-descriptor',
                    operation: transaction.operation,
                    transactionId: transaction.transactionId,
                    property,
                    data: hex(bytes.subarray(offset, offset + decoded.bytesRead)),
                })
            offset += decoded.bytesRead
        }
        if (offset !== bytes.length) throw new Error('Unexpected Sony inventory trailer')
    }
    if (response.data || dataFromHost) result.redactions = ['private-or-unscoped-payload']
    return result
}

/** Runs only when explicitly invoked; callers own the physical bench lease and recovery policy. */
export async function captureCameraProfile(source: TransportInterface, options: ProfileCaptureOptions) {
    if (options.liveView && !options.initialize) throw new Error('Live view requires explicit initialization')
    const limit = options.maxProperties ?? 128
    const seconds = options.timeoutSeconds ?? 60
    if (!Number.isInteger(limit) || limit < 1 || limit > 512) throw new Error('maxProperties must be between 1 and 512')
    if (!Number.isInteger(seconds) || seconds < 5 || seconds > 300)
        throw new Error('timeoutSeconds must be between 5 and 300')
    const capturedAt = new Date().toISOString()
    const deadline = Date.now() + seconds * 1000
    const transactions: TraceTransaction[] = []
    const observations: ProfileObservation[] = []
    const checks: Array<{ id: string; status: 'pass' | 'error' | 'skipped'; detail?: string }> = []
    let retainedBytes = 0
    let budgetReached = false
    const device: { vendorId: number; productId: number; manufacturer?: string; model?: string; firmware?: string } = {
        vendorId: options.vendorId,
        productId: options.productId,
    }
    const trace = recordPtpTransport(source, transaction => {
        if (transactions.length >= 4096) {
            budgetReached = true
            return
        }
        const previousObservations = observations.length
        try {
            const sanitized = sanitizeProfileTransaction(transaction, options.vendorId, observations)
            const bytes =
                ((sanitized.dataFromHost?.length ?? 0) +
                    (sanitized.response.data?.length ?? 0) +
                    observations.slice(previousObservations).reduce((sum, entry) => sum + entry.data.length, 0)) /
                2
            if (retainedBytes + bytes > 8 * 1024 * 1024) {
                budgetReached = true
                throw new Error('Capture retention limit reached')
            }
            retainedBytes += bytes
            transactions.push(sanitized)
        } catch {
            observations.splice(previousObservations)
            transactions.push({
                operation: transaction.operation,
                transactionId: transaction.transactionId,
                parameters: transaction.parameters,
                response: { code: transaction.response.code, parameters: transaction.response.parameters },
                redactions: ['invalid-or-private-payload'],
            })
        }
    })
    const logger = new Logger({ renderInTerminal: false, captureConsole: false, expanded: false })
    const registry = captureRegistry(options.vendorId)
    const camera = options.initialize
        ? new Camera({
              transport: trace.transport,
              vendorId: options.vendorId,
              logger: { renderInTerminal: false, captureConsole: false },
          }).getInstance()
        : new GenericCamera(trace.transport, logger)
    if (!options.initialize) Object.assign(camera, { registry })
    camera.configureTransactions({ timeoutMilliseconds: 2000, deviceBusyRetries: 0, automaticUSBReset: false })
    const check = async <T>(id: string, action: () => Promise<T>, cleanup = false): Promise<T | undefined> => {
        if (!cleanup && Date.now() >= deadline) {
            checks.push({ id, status: 'skipped', detail: 'Capture deadline reached' })
            return undefined
        }
        try {
            const value = await action()
            checks.push({ id, status: 'pass' })
            return value
        } catch (error) {
            const failure = error as { name?: string; code?: number }
            checks.push({
                id,
                status: 'error',
                detail: `${failure.name || 'Error'}${typeof failure.code === 'number' ? ` (0x${failure.code.toString(16)})` : ''}`,
            })
            return undefined
        }
    }
    const send = async (operation: OperationDefinition, parameters: Record<string, unknown> = {}) => {
        const response = (await camera.send(operation, parameters as never, undefined, 1024 * 1024)) as {
            code: number
            data?: unknown
        }
        if (response.code !== 0x2001) throw Object.assign(new Error('Camera refused read'), { code: response.code })
        return response.data
    }
    try {
        const selection = {
            usb: {
                filters: [
                    {
                        vendorId: options.vendorId,
                        productId: options.productId,
                        ...(options.serialNumber && { serialNumber: options.serialNumber }),
                        classCode: 6,
                        subclassCode: 1,
                    },
                ],
            },
        }
        await check('session', () =>
            camera instanceof SonyCamera ? camera.connect(selection, { configure: false }) : camera.connect(selection)
        )
        const info = await check('device-info', () => send(registry.operations.GetDeviceInfo))
        if (info) {
            const identity = info as ReturnType<DeviceInfoCodec['decode']>['value']
            Object.assign(device, {
                manufacturer: identity.manufacturer,
                model: identity.model,
                firmware: identity.deviceVersion,
            })
            const supported = new Set(identity.operationsSupportedRaw)
            const safe = capturePropertyCodes(options.vendorId)
            let properties = identity.devicePropertiesSupported.filter(code => safe.has(code))
            if (options.vendorId === 0x054c && supported.has(0x9209)) {
                await check('sony-property-inventory', () =>
                    send(createSonyRegistry(true).operations.SDIO_GetAllExtDevicePropInfo, {
                        flagOfGetOnlyDifferenceData: 0,
                        flagOfDevicePropertyOption: 'ENABLE',
                    })
                )
                properties = [
                    ...new Set([
                        ...properties,
                        ...observations
                            .filter(item => item.kind === 'sony-property-descriptor')
                            .map(item => item.property),
                    ]),
                ]
            }
            if (options.vendorId === 0x04b0 && supported.has(0x9439)) {
                const data = await check('nikon-vendor-property-codes', () =>
                    send(createNikonRegistry(true).operations.GetVendorCodes, { Kind: 13 })
                )
                if (data instanceof Uint8Array && data.length >= 4) {
                    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
                    const count = view.getUint32(0, true)
                    if (count <= 4096 && data.length === 4 + count * 4)
                        properties = [
                            ...new Set([
                                ...properties,
                                ...Array.from({ length: count }, (_, index) =>
                                    view.getUint32(4 + index * 4, true)
                                ).filter(code => safe.has(code)),
                            ]),
                        ]
                }
            }
            for (const property of properties.slice(0, limit)) {
                if (Date.now() >= deadline) break
                const operation =
                    options.vendorId === 0x054c && supported.has(0x9251)
                        ? createSonyRegistry(true).operations.SDIO_GetExtDevicePropValue
                        : options.vendorId === 0x04b0 && supported.has(0x943a)
                          ? createNikonRegistry(true).operations.GetDevicePropDescEx
                          : registry.operations.GetDevicePropDesc
                await check(`property-0x${property.toString(16)}`, () => send(operation, { DevicePropCode: property }))
            }
            if (options.vendorId === 0x04a9) {
                const operations = createCanonRegistry(true).operations
                if (supported.has(0x9108))
                    await check('canon-extended-device-info', () => send(operations.CanonGetExtendedDeviceInfo))
                if (supported.has(0x9116))
                    await check('canon-event-properties', () => send(operations.CanonGetEventData))
            }
            if (options.vendorId === 0x04b0 && supported.has(0x941c))
                await check('nikon-events', () =>
                    send(createNikonRegistry(true).operations.GetEventEx, { KeepEvents: 'RETAIN' })
                )
            else if (options.vendorId === 0x04b0 && supported.has(0x90c7))
                await check('nikon-events', () => send(createNikonRegistry(true).operations.GetEvent))
            if (options.liveView)
                await check('live-view', async () => {
                    const frame = await camera.captureLiveView({ includeInfo: false, includeData: true })
                    if (!frame.data?.length) throw new Error('No live-view image')
                })
            if (properties.length > limit || Date.now() >= deadline)
                checks.push({
                    id: 'property-coverage',
                    status: 'skipped',
                    detail: 'Property count or time bound reached; capture is partial',
                })
        }
    } finally {
        await check('disconnect', () => camera.disconnect(), true)
    }
    if (budgetReached)
        checks.push({
            id: 'trace-coverage',
            status: 'skipped',
            detail: 'Trace retention bound reached; capture is partial',
        })
    return {
        schema: 'darkgrade.ptp-trace/v1' as const,
        capturedAt,
        revision: options.revision,
        device,
        mode: options.initialize ? ('initialized' as const) : ('read-only' as const),
        checks,
        transactions,
        observations,
        events: trace.events,
        skippedIncomplete: trace.skippedIncomplete(),
    }
}
