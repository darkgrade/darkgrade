import { protocolProperties } from '@contribute/protocol-properties'

export type ProtocolCategory = 'operation' | 'event' | 'property' | 'response'
export type ProtocolNumber = number | string
export type StatePhase = 'before-prepare' | 'after-prepare' | 'before-start' | 'after-start' | 'before-stop' | 'after-stop' | 'failure' | 'after-cleanup'
export interface ObservedSetting { property: number; dataType: number; current: ProtocolNumber; ageMilliseconds: number }
export type ProtocolEvidence = {
    vendorId: number
    benchmarkId?: string
} & (
    | { type: 'inventory'; category: ProtocolCategory; codes: number[] }
    | { type: 'unknown'; category: ProtocolCategory; code: number; advertised: boolean }
    | {
          type: 'state-snapshot'
          workflow: 'recording' | 'photo' | 'benchmark'
          phase: StatePhase
          basis: 'observed-cache'
          settings: ObservedSetting[]
      }
    | {
          type: 'property-write'
          property: number
          dataType: number
          requested: ProtocolNumber
          transactionId: number
          outcome: 'response' | 'error'
          response?: number
          /** The last value read before the write (from the observed cache, never a new read) and its age. */
          prior?: ProtocolNumber
          priorAgeMilliseconds?: number
      }
    | {
          /** A focus-point command's position in the camera's own units (Nikon ChangeAfArea, Sony AF-area position). */
          type: 'focus-point'
          x: number
          y: number
          transactionId: number
          outcome: 'response' | 'error'
          response?: number
      }
    | {
          /** The numeric fields of an ObjectInfo dataset: no file name, keywords or handle. */
          type: 'object-info'
          format: number
          /** As the camera sent it: 0xffffffff means larger than 4 GiB. */
          size: number
          /** The camera clock's PTP DateTime (`YYYYMMDDThhmmss`), when it sent one. */
          captureDate?: string
          transactionId: number
      }
    | {
          /** An object read's byte counts: the first request of a transfer, a short read and any failed read. */
          type: 'transfer'
          offset?: ProtocolNumber
          requestedBytes?: number
          receivedBytes?: number
          transactionId: number
          outcome: 'response' | 'error'
          response?: number
      }
    | {
          /** A warning register read after an error response (Nikon WarningStatus after HardwareError). */
          type: 'warning-status'
          property: number
          value: number
          flags: string[]
          /** The operation and transaction whose response prompted the read. */
          operation: number
          transactionId: number
      }
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
    | {
          /** A value or choice the property's codec rejected, sent as its raw number. `choice` marks an advertised option. */
          type: 'unrecognized-value'
          property: number
          dataType: number
          raw: ProtocolNumber
          choice: boolean
      }
    | {
          type: 'benchmark'
          status: 'started' | 'complete' | 'partial' | 'cancelled'
          checks: number
          failures: number
          purpose?: 'first-contact'
      }
)
const integer = (value: unknown, maximum = 0xffffffff): value is number =>
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

/** A request's transaction and how it ended: a response code, or an error before one arrived. */
const requestOutcome = (item: { transactionId: unknown; outcome: unknown; response?: unknown }) =>
    integer(item.transactionId) &&
    ['response', 'error'].includes(String(item.outcome)) &&
    (item.outcome === 'response' ? integer(item.response, 0xffff) : item.response === undefined)

export function isSafeProtocolProperty(vendorId: number, property: number) {
    return (protocolProperties[vendorId] ?? protocolProperties[0]).includes(property)
}

/** An allowlisted property of this vendor with a standard integer datatype code (1 to 10). */
const safeProperty = (vendorId: number, property: unknown, dataType: unknown) =>
    integer(property) && isSafeProtocolProperty(vendorId, property) && integer(dataType, 10) && dataType >= 1

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
    } else if (item.type === 'state-snapshot') {
        fields = ['workflow', 'phase', 'basis', 'settings']
        if (
            !['recording', 'photo', 'benchmark'].includes(item.workflow) ||
            !['before-prepare', 'after-prepare', 'before-start', 'after-start', 'before-stop', 'after-stop', 'failure', 'after-cleanup'].includes(item.phase) ||
            item.basis !== 'observed-cache' ||
            !Array.isArray(item.settings) || item.settings.length > 32 ||
            new Set(item.settings.map(setting => setting?.property)).size !== item.settings.length ||
            item.settings.some(setting => !setting || typeof setting !== 'object' ||
                Object.keys(setting).some(key => !['property', 'dataType', 'current', 'ageMilliseconds'].includes(key)) ||
                !safeProperty(item.vendorId, setting.property, setting.dataType) || !fits(setting.current, setting.dataType) ||
                !integer(setting.ageMilliseconds))
        ) throw new Error('Invalid observed state snapshot')
    } else if (item.type === 'property-write') {
        fields = ['property', 'dataType', 'requested', 'transactionId', 'outcome', 'response', 'prior', 'priorAgeMilliseconds']
        if (
            !safeProperty(item.vendorId, item.property, item.dataType) ||
            !fits(item.requested, item.dataType) ||
            !requestOutcome(item) ||
            (item.prior === undefined) !== (item.priorAgeMilliseconds === undefined) ||
            (item.prior !== undefined && !fits(item.prior, item.dataType)) ||
            (item.priorAgeMilliseconds !== undefined && !integer(item.priorAgeMilliseconds))
        ) throw new Error('Invalid property write evidence')
    } else if (item.type === 'focus-point') {
        fields = ['x', 'y', 'transactionId', 'outcome', 'response']
        if (!integer(item.x, 0xffff) || !integer(item.y, 0xffff) || !requestOutcome(item)) throw new Error('Invalid focus point evidence')
    } else if (item.type === 'object-info') {
        fields = ['format', 'size', 'captureDate', 'transactionId']
        if (
            !integer(item.format, 0xffff) ||
            !integer(item.size) ||
            !integer(item.transactionId) ||
            (item.captureDate !== undefined &&
                (typeof item.captureDate !== 'string' || !/^\d{8}T\d{6}(?:\.\d)?(?:Z|[+-]\d{4})?$/.test(item.captureDate)))
        )
            throw new Error('Invalid object info evidence')
    } else if (item.type === 'transfer') {
        fields = ['offset', 'requestedBytes', 'receivedBytes', 'transactionId', 'outcome', 'response']
        if (
            (item.offset !== undefined && !fits(item.offset, 8)) ||
            (item.requestedBytes !== undefined && !integer(item.requestedBytes)) ||
            (item.receivedBytes !== undefined && !integer(item.receivedBytes)) ||
            !requestOutcome(item)
        )
            throw new Error('Invalid transfer evidence')
    } else if (item.type === 'warning-status') {
        fields = ['property', 'value', 'flags', 'operation', 'transactionId']
        if (
            !integer(item.property) ||
            !integer(item.value) ||
            !Array.isArray(item.flags) ||
            item.flags.length > 32 ||
            item.flags.some(flag => typeof flag !== 'string' || !/^[a-z][a-z-]{0,31}$/.test(flag)) ||
            !integer(item.operation, 0xffff) ||
            !integer(item.transactionId)
        )
            throw new Error('Invalid warning status evidence')
    } else if (item.type === 'descriptor' || item.type === 'property-value') {
        fields =
            item.type === 'descriptor'
                ? ['property', 'dataType', 'writable', 'current', 'default', 'values', 'minimum', 'maximum', 'step']
                : ['property', 'dataType', 'current', 'values']
        if (
            !safeProperty(item.vendorId, item.property, item.dataType) ||
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
    } else if (item.type === 'unrecognized-value') {
        fields = ['property', 'dataType', 'raw', 'choice']
        if (
            !safeProperty(item.vendorId, item.property, item.dataType) ||
            !fits(item.raw, item.dataType) ||
            typeof item.choice !== 'boolean'
        ) throw new Error('Invalid unrecognized value evidence')
    } else if (item.type === 'benchmark') {
        fields = ['status', 'checks', 'failures', 'purpose']
        if (
            !item.benchmarkId ||
            (item.purpose !== undefined && item.purpose !== 'first-contact') ||
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
