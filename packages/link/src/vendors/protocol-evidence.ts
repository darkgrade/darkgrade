import {
    isSafeProtocolProperty,
    validateProtocol,
    type ProtocolCategory,
    type ProtocolEvidence,
} from '@darkgrade/contribute/protocol'
import type { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import type { Registry } from '@ptp/registry'

/** Retain decoded numeric protocol datasets only; unknown payloads are never copied. */
export function protocolEvidence(
    vendorId: number,
    registry: Registry,
    operation: number,
    data: unknown
): ProtocolEvidence[] {
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
