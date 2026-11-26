import {
    isSafeProtocolProperty,
    validateProtocol,
    type ProtocolCategory,
    type ProtocolEvidence,
    type StatePhase,
} from '@contribute/protocol'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { createCanonRegistry, createNikonRegistry, createSonyRegistry, type Registry } from '@vendors/registry'

const definitionsByVendor = new Map<number, Registry>([
    [0x04a9, createCanonRegistry(true)],
    [0x04b0, createNikonRegistry(true)],
    [0x054c, createSonyRegistry(true)],
])

/** The USB vendor of a DeviceInfo's manufacturer, for the vendors whose definitions judge an inventory. */
function deviceInfoVendor(data: unknown): number | undefined {
    const manufacturer = (data as { manufacturer?: unknown } | undefined)?.manufacturer
    if (typeof manufacturer !== 'string') return
    if (/^\s*canon\b/i.test(manufacturer)) return 0x04a9
    if (/^\s*nikon\b/i.test(manufacturer)) return 0x04b0
    if (/^\s*sony\b/i.test(manufacturer)) return 0x054c
}

export interface CachedDiagnosticSetting { property: number; dataType: number; current: number | string; observedAt: number }
/** Bounded cache-only evidence: never query a camera or infer state from acknowledged writes. */
export function stateSnapshotEvidence(
    vendorId: number, cache: Iterable<CachedDiagnosticSetting>,
    workflow: 'recording' | 'photo' | 'benchmark', phase: StatePhase, now: number
): ProtocolEvidence {
    // Prioritize mode/destination/recording, then exposure controls, before other reviewed values.
    const priority = vendorId === 0x04a9 ? [0xd1c2, 0xd105, 0xd11c, 0xd1b8, 0xd1b0, 0xd101, 0xd102, 0xd103, 0xd109]
        : [0x500e, 0x500f, 0x5007, 0x500d, 0x5005, 0x5001]
    const rank = (property: number) => priority.includes(property) ? priority.indexOf(property) : priority.length + property
    const settings = [...cache].filter(item => now >= item.observedAt && now - item.observedAt <= 0xffffffff)
        .sort((a, b) => rank(a.property) - rank(b.property)).slice(0, 32)
        .map(({ observedAt, ...setting }) => ({ ...setting, ageMilliseconds: Math.floor(now - observedAt) }))
    const evidence: ProtocolEvidence = { type: 'state-snapshot', vendorId, workflow, phase, basis: 'observed-cache', settings }
    validateProtocol(evidence)
    return evidence
}

/** Decode only Canon's single numeric property-write envelope, never generic USB payloads.
 * A response acknowledges the request; it is not a property readback or a hardware pass.
 */
export function propertyWriteEvidence(
    vendorId: number, operation: number, data: Uint8Array | undefined,
    transactionId: number, response?: number
): ProtocolEvidence | undefined {
    if (vendorId !== 0x04a9 || operation !== 0x9110 || data?.byteLength !== 12) return
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    if (view.getUint32(0, true) !== data.byteLength) return
    const property = view.getUint32(4, true)
    const evidence: ProtocolEvidence = {
        type: 'property-write', vendorId, property, dataType: 6,
        requested: view.getUint32(8, true), transactionId,
        outcome: response === undefined ? 'error' : 'response',
        ...(response !== undefined && { response }),
    }
    try { validateProtocol(evidence); return evidence } catch { return }
}

/** What the session last observed about a property: its datatype and, when cached, its value and when it was read. */
export interface ObservedProperty { dataType?: number; current?: number | string; observedAt?: number }
type RequestParameters = Record<string, number | bigint | string>
/** Sony's AF-area position control: X in the upper 16 bits, Y in the lower (SDIO_ControlDevice 0xd2dc). */
const SONY_AF_AREA_POSITION = 0xd2dc
const SONY_LIVE_VIEW_HANDLE = 0xffffc002
const PROPERTY_WRITES = new Set(['SetDevicePropValue', 'SetDevicePropValueEx', 'SDIO_SetExtDevicePropValue', 'SDIO_ControlDevice'])
const OBJECT_READS = /^(?:GetObject|\w*PartialObject\w*)$/

/** A little-endian integer of the datatype's exact size, as a number or (beyond 2^53) a decimal string. */
function integerValue(bytes: Uint8Array, dataType: number): number | string | undefined {
    if (!Number.isSafeInteger(dataType) || dataType < 1 || dataType > 10) return
    const size = 2 ** Math.floor((dataType - 1) / 2)
    if (bytes.byteLength !== size) return
    let value = 0n
    for (let index = size - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[index]!)
    if (dataType % 2 === 1 && value >= 1n << BigInt(8 * size - 1)) value -= 1n << BigInt(8 * size)
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString()
}

/**
 * Numeric request evidence for one transaction, so Telemetry can say which value, position or byte
 * range a failing command asked for: property writes (with the value last observed before them),
 * focus-point positions, ObjectInfo's format, size and capture date, and object reads' byte counts
 * (the first request of a transfer, a short read and any failure). Never file names, handles or payloads.
 */
export function requestEvidence(
    vendorId: number,
    operation: { code: number; name: string },
    parameters: RequestParameters,
    sent: Uint8Array | undefined,
    transactionId: number,
    response: { code: number; data?: unknown } | undefined,
    observed: (property: number) => ObservedProperty | undefined,
    now: number
): ProtocolEvidence[] {
    const outcome = response === undefined
        ? { transactionId, outcome: 'error' as const }
        : { transactionId, outcome: 'response' as const, response: response.code }
    const valid = (item: ProtocolEvidence | undefined): ProtocolEvidence[] => {
        if (!item) return []
        try {
            validateProtocol(item)
            return [item]
        } catch {
            return []
        }
    }
    const prior = (property: number, dataType: number) => {
        const seen = observed(property)
        if (seen?.current === undefined || seen.observedAt === undefined || now < seen.observedAt) return {}
        if (seen.dataType !== undefined && seen.dataType !== dataType) return {}
        return { prior: seen.current, priorAgeMilliseconds: Math.floor(now - seen.observedAt) }
    }
    const canon = propertyWriteEvidence(vendorId, operation.code, sent, transactionId, response?.code)
    if (canon?.type === 'property-write') return valid({ ...canon, ...prior(canon.property, canon.dataType) })
    if (operation.name === 'ChangeAfArea')
        return valid({ type: 'focus-point', vendorId, x: Number(parameters.X), y: Number(parameters.Y), ...outcome })
    if (PROPERTY_WRITES.has(operation.name) && sent) {
        const property = Number(parameters.DevicePropCode ?? parameters.sdiControlCode)
        if (vendorId === 0x054c && property === SONY_AF_AREA_POSITION && sent.byteLength === 4) {
            const packed = new DataView(sent.buffer, sent.byteOffset, 4).getUint32(0, true)
            return valid({ type: 'focus-point', vendorId, x: packed >>> 16, y: packed & 0xffff, ...outcome })
        }
        const dataType = observed(property)?.dataType
        const requested = dataType === undefined ? undefined : integerValue(sent, dataType)
        if (dataType === undefined || requested === undefined) return []
        return valid({ type: 'property-write', vendorId, property, dataType, requested, ...outcome, ...prior(property, dataType) })
    }
    if (Number(parameters.ObjectHandle) === SONY_LIVE_VIEW_HANDLE && vendorId === 0x054c) return []
    if (operation.code === 0x1008 && response?.code === 0x2001) {
        const info = response.data as Partial<ObjectInfo> | undefined
        if (!info || typeof info !== 'object') return []
        return valid({
            type: 'object-info', vendorId, format: Number(info.objectFormat), size: Number(info.objectCompressedSize),
            ...(info.captureDate && { captureDate: info.captureDate }), transactionId,
        })
    }
    if (!OBJECT_READS.test(operation.name) || /Info|Handles/.test(operation.name)) return []
    const offset = parameters.Offset !== undefined
        ? BigInt(parameters.Offset)
        : parameters.OffsetLower !== undefined
          ? (BigInt(parameters.OffsetUpper ?? 0) << 32n) | BigInt(parameters.OffsetLower)
          : undefined
    const requestedBytes = parameters.MaxBytes === undefined ? undefined : Number(parameters.MaxBytes)
    const receivedBytes = response?.data instanceof Uint8Array ? response.data.byteLength : undefined
    const notable = !offset || response?.code !== 0x2001 ||
        (requestedBytes !== undefined && receivedBytes !== undefined && receivedBytes < requestedBytes)
    if (!notable) return []
    return valid({
        type: 'transfer', vendorId,
        ...(offset !== undefined && { offset: offset <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(offset) : offset.toString() }),
        ...(requestedBytes !== undefined && { requestedBytes }),
        ...(receivedBytes !== undefined && { receivedBytes }),
        ...outcome,
    })
}

/** Nikon WarningStatus (0xd102) bits, Z5_2 USB/MTP reference §6.5.6.24; other bits stay in `value`. */
const NIKON_WARNING_FLAGS = ['sequence-error', 'battery-exhausted'] as const
export function warningStatusEvidence(
    vendorId: number, property: number, value: number, operation: number, transactionId: number
): ProtocolEvidence | undefined {
    const flags = vendorId === 0x04b0 && property === 0xd102
        ? NIKON_WARNING_FLAGS.filter((_flag, bit) => (value >>> bit) & 1)
        : []
    const evidence: ProtocolEvidence = { type: 'warning-status', vendorId, property, value, flags: [...flags], operation, transactionId }
    try { validateProtocol(evidence); return evidence } catch { return }
}

/** Retain decoded numeric protocol datasets only; unknown payloads are never copied. */
export function protocolEvidence(vendorId: number, registry: Registry, operation: number, data: unknown): ProtocolEvidence[] {
    // A driver that has not chosen its vendor yet (discovery, the bench probe) still reads a body
    // with vendor operations: judge its DeviceInfo against the vendor it names, not the standard set.
    if (vendorId === 0 && operation === 0x1001) vendorId = deviceInfoVendor(data) ?? 0
    // Discovery starts through GenericCamera before it creates the vendor camera.
    // Judge known codes against the vendor definitions, not that temporary registry.
    registry = definitionsByVendor.get(vendorId) ?? registry
    const result: ProtocolEvidence[] = []
    /** Unscoped or invalid evidence is excluded; reports whether the item was kept. */
    const add = (item: ProtocolEvidence): boolean => {
        try {
            validateProtocol(item)
        } catch {
            return false
        }
        result.push(item)
        return true
    }
    const inventory = (category: ProtocolCategory, input: unknown) => {
        if (!Array.isArray(input) || input.length > 4096) return
        const codes = [...new Set(input)] as number[]
        if (!add({ type: 'inventory', vendorId, category, codes })) return
        const definitions =
            category === 'property'
                ? registry.properties
                : category === 'operation'
                  ? registry.operations
                  : category === 'event'
                    ? registry.events
                    : registry.responses
        const known = new Set(Object.values(definitions).map(definition => definition.code))
        for (const code of codes)
            if (!known.has(code)) add({ type: 'unknown', vendorId, category, code, advertised: true })
    }
    const descriptor = (input: unknown) => {
        const value = input as DevicePropDesc
        if (!value || !isSafeProtocolProperty(vendorId, value.devicePropertyCode)) return
        const numeric = (field: unknown) => (typeof field === 'bigint' ? field.toString() : (field as number))
        const item: ProtocolEvidence = { type: 'descriptor', vendorId, property: value.devicePropertyCode,
            dataType: value.dataType, writable: value.getSet === 'GET_SET' }
        for (const [target, source] of Object.entries({
            current: 'currentValueRaw',
            default: 'factoryDefaultValue',
            minimum: 'minimumValue',
            maximum: 'maximumValue',
            step: 'stepSize',
        })) {
            const field = (value as unknown as Record<string, unknown>)[source]
            if (field !== undefined) Object.assign(item, { [target]: numeric(field) })
        }
        if (value.supportedValuesRaw) item.values = value.supportedValuesRaw.map(numeric)
        add(item)
        const unrecognized = (raw: unknown, choice: boolean) =>
            add({ type: 'unrecognized-value', vendorId, property: value.devicePropertyCode, dataType: value.dataType, raw: numeric(raw), choice })
        if (value.currentValueUnrecognized) unrecognized(value.currentValueRaw, false)
        for (const raw of value.unrecognizedSupportedValues?.slice(0, 512) ?? []) unrecognized(raw, true)
    }
    const value = data as Record<string, unknown> | undefined
    if (!value || typeof value !== 'object') return result
    if (operation === 0x1001) {
        inventory('operation', value.operationsSupportedRaw)
        inventory('event', value.eventsSupportedRaw)
        inventory('property', value.devicePropertiesSupported)
    } else if (operation === 0x1014 || (vendorId === 0x04b0 && operation === 0x943a)) {
        descriptor(data)
    } else if (vendorId === 0x054c && operation === 0x9209 && Array.isArray(value.properties)) {
        inventory('property', value.properties.map(property => property.devicePropertyCode))
        for (const property of value.properties.slice(0, 4096)) descriptor(property)
    } else if (vendorId === 0x04a9 && operation === 0x9108) {
        inventory('event', value.eventCodes)
        inventory('property', value.propertyCodes)
    } else if (vendorId === 0x04a9 && operation === 0x9116 && Array.isArray(data)) {
        for (const event of data.slice(0, 4096)) {
            const property = event.parameters?.[0]
            if (![0xc189, 0xc18a].includes(event.code) || !Number.isSafeInteger(property)) continue
            const known = Object.values(registry.properties).some(item => item.code === property)
            if (!known) add({ type: 'unknown', vendorId, category: 'property', code: property, advertised: true })
            if (!isSafeProtocolProperty(vendorId, property)) continue
            if (event.code === 0xc189 && event.valueData?.length === 4)
                add({ type: 'property-value', vendorId, property, dataType: 6, current: event.parameters[1] })
            if (event.code === 0xc18a && event.allowedValues && event.allowedValueData?.every((bytes: Uint8Array) => bytes.length === 4))
                add({ type: 'property-value', vendorId, property, dataType: 6, values: event.allowedValues })
        }
    }
    return result
}
