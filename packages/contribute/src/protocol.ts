import { protocolProperties } from '#contribute/protocol-properties'

export type ProtocolCategory = 'operation' | 'event' | 'property' | 'response'
export type ProtocolNumber = number | string
export type ProtocolEvidence = {
    vendorId: number
    benchmarkId?: string
} & (
    | { type: 'inventory'; category: ProtocolCategory; codes: number[] }
    | { type: 'unknown'; category: ProtocolCategory; code: number; advertised: boolean }
    | {
          type: 'descriptor'
          property: number
          dataType: number
          writable: boolean
          current?: ProtocolNumber
          default?: ProtocolNumber
          values?: ProtocolNumber[]
          minimum?: ProtocolNumber
          maximum?: ProtocolNumber
          step?: ProtocolNumber
      }
    | {
          type: 'property-value'
          property: number
          dataType: number
          current?: ProtocolNumber
          values?: ProtocolNumber[]
      }
    | { type: 'benchmark'; status: 'started' | 'complete' | 'partial' | 'cancelled'; checks: number; failures: number }
)
const integer = (value: unknown, maximum = 0xffffffff) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum
const numeric = (value: unknown) =>
    (typeof value === 'number' && Number.isSafeInteger(value)) ||
    (typeof value === 'string' &&
        /^-?(0|[1-9][0-9]{0,38})$/.test(value) &&
        BigInt(value) >= -(1n << 127n) &&
        BigInt(value) < 1n << 128n)
const fits = (value: unknown, dataType: number) => {
    if (!numeric(value)) return false
    const bits = BigInt(8 * 2 ** Math.floor((dataType - 1) / 2))
    const signed = dataType % 2 === 1
    const integer = BigInt(value as string | number)
    return integer >= (signed ? -(1n << (bits - 1n)) : 0n) && integer < 1n << (signed ? bits - 1n : bits)
}

export function isSafeProtocolProperty(vendorId: number, property: number) {
    return (protocolProperties[vendorId] ?? protocolProperties[0]).includes(property)
}

/** Explicit numeric fields only. This never accepts raw payloads, device text, filenames or credentials. */
export function validateProtocol(value: unknown): asserts value is ProtocolEvidence {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid protocol evidence')
    const item = value as ProtocolEvidence
    const common = ['type', 'vendorId', 'benchmarkId']
    if (
        !integer(item.vendorId, 0xffff) ||
        (item.benchmarkId !== undefined &&
            !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(item.benchmarkId))
    )
        throw new Error('Invalid protocol scope')
    let fields: string[]
    if (item.type === 'inventory' || item.type === 'unknown') {
        if (!['operation', 'event', 'property', 'response'].includes(item.category))
            throw new Error('Invalid protocol category')
        const maximum = item.category === 'property' ? 0xffffffff : 0xffff
        if (item.type === 'inventory') {
            fields = ['category', 'codes']
            if (
                !Array.isArray(item.codes) ||
                item.codes.length > 4096 ||
                item.codes.some(code => !integer(code, maximum)) ||
                new Set(item.codes).size !== item.codes.length
            )
                throw new Error('Invalid capability inventory')
        } else {
            fields = ['category', 'code', 'advertised']
            if (!integer(item.code, maximum) || typeof item.advertised !== 'boolean')
                throw new Error('Invalid unknown code')
        }
    } else if (item.type === 'descriptor' || item.type === 'property-value') {
        fields =
            item.type === 'descriptor'
                ? ['property', 'dataType', 'writable', 'current', 'default', 'values', 'minimum', 'maximum', 'step']
                : ['property', 'dataType', 'current', 'values']
        if (
            !integer(item.property) ||
            !isSafeProtocolProperty(item.vendorId, item.property) ||
            !integer(item.dataType, 10) ||
            item.dataType < 1 ||
            (item.type === 'descriptor' && typeof item.writable !== 'boolean') ||
            ['current', 'default', 'minimum', 'maximum', 'step'].some(
                key => key in item && !fits((item as unknown as Record<string, unknown>)[key], item.dataType)
            ) ||
            (item.values !== undefined &&
                (!Array.isArray(item.values) ||
                    item.values.length > 512 ||
                    !item.values.every(value => fits(value, item.dataType))))
        )
            throw new Error('Invalid numeric descriptor')
    } else if (item.type === 'benchmark') {
        fields = ['status', 'checks', 'failures']
        if (
            !item.benchmarkId ||
            !['started', 'complete', 'partial', 'cancelled'].includes(item.status) ||
            !integer(item.checks, 1024) ||
            !integer(item.failures, 1024) ||
            item.failures > item.checks
        )
            throw new Error('Invalid benchmark summary')
    } else throw new Error('Unknown protocol evidence type')
    if (Object.keys(item).some(key => !common.includes(key) && !fields.includes(key)))
        throw new Error('Unexpected protocol field')
}
