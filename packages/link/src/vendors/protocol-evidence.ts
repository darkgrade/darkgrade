import {
    isSafeProtocolProperty,
    validateProtocol,
    type ProtocolCategory,
    type ProtocolEvidence,
    type StatePhase,
} from '@darkgrade/contribute/protocol'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { createCanonRegistry, createNikonRegistry, createSonyRegistry, type Registry } from '@ptp/registry'

const definitionsByVendor = new Map<number, Registry>([
    [0x04a9, createCanonRegistry(true)],
    [0x04b0, createNikonRegistry(true)],
    [0x054c, createSonyRegistry(true)],
])

export interface CachedDiagnosticSetting { property: number; dataType: number; current: number | string; observedAt: number }
/** Bounded cache-only evidence: never query a camera or infer state from acknowledged writes. */
export function stateSnapshotEvidence(
    vendorId: number, cache: Iterable<CachedDiagnosticSetting>,
    workflow: 'recording' | 'photo', phase: StatePhase, now: number
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

/** Retain decoded numeric protocol datasets only; unknown payloads are never copied. */
export function protocolEvidence(
    vendorId: number,
    registry: Registry,
    operation: number,
    data: unknown
): ProtocolEvidence[] {
    // Discovery starts through GenericCamera before it creates the vendor camera.
    // Judge known codes against the vendor definitions, not that temporary registry.
    registry = definitionsByVendor.get(vendorId) ?? registry
    const result: ProtocolEvidence[] = []
    const add = (item: ProtocolEvidence) => {
        try {
            validateProtocol(item)
            result.push(item)
        } catch {
            /* Unscoped/invalid data remains excluded. */
        }
    }
    const inventory = (category: ProtocolCategory, input: unknown) => {
        if (!Array.isArray(input) || input.length > 4096) return
        const codes = [...new Set(input)] as number[]
        const item: ProtocolEvidence = { type: 'inventory', vendorId, category, codes }
        try {
            validateProtocol(item)
        } catch {
            return
        }
        add(item)
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
        const item: ProtocolEvidence = {
            type: 'descriptor',
            vendorId,
            property: value.devicePropertyCode,
            dataType: value.dataType,
            writable: value.getSet === 'GET_SET',
        }
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
        inventory(
            'property',
            value.properties.map(property => property.devicePropertyCode)
        )
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
            if (
                event.code === 0xc18a &&
                event.allowedValues &&
                event.allowedValueData?.every((bytes: Uint8Array) => bytes.length === 4)
            )
                add({ type: 'property-value', vendorId, property, dataType: 6, values: event.allowedValues })
        }
    }
    return result
}
