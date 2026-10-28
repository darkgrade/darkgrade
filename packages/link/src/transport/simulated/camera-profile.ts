/**
 * Camera profiles describe one camera model for SimulatedTransport.
 *
 * Every code is written as a hexadecimal string ("0x1001") and every byte sequence as a
 * contiguous lowercase hexadecimal string, so profiles stay readable and diffable.
 * A profile only contains what its provenance supports: anything not recorded is absent,
 * and the simulator reports the absence instead of inventing a response.
 */

/** "captured": built from real hardware evidence. "documented": built from vendor documentation only. */
export type ProfileFidelity = 'captured' | 'documented'

export interface ProfileSource {
    /** Repository path ("darkgrade/test-bench@2db7a28:docs/camera-compatibility.md") or URL. */
    location: string
    /** Verbatim text from the source that supports the facts citing it. */
    excerpt?: string
}

export interface ProfileProvenance {
    fidelity: ProfileFidelity
    sources: ProfileSource[]
}

/** A parsed PTP DeviceInfo. Arrays are only present when the complete list is known. */
export interface ProfileDeviceInfo {
    /** Complete GetDeviceInfo dataset bytes. Takes precedence over every parsed field. */
    raw?: string
    /** `${manufacturer} ${model}` exactly as darkgrade reported it, when the split is unknown. */
    reportedIdentity?: string
    /**
     * True only when the operation, event and property lists are the camera's complete lists
     * (for example decoded from a captured dataset). Only then does the simulator answer
     * OperationNotSupported / DevicePropNotSupported for codes absent from them.
     */
    listsComplete?: boolean
    standardVersion?: number
    vendorExtensionId?: string
    vendorExtensionVersion?: number
    vendorExtensionDescription?: string
    functionalMode?: number
    operationsSupported?: string[]
    eventsSupported?: string[]
    devicePropertiesSupported?: string[]
    captureFormats?: string[]
    imageFormats?: string[]
    manufacturer?: string
    model?: string
    deviceVersion?: string
    serialNumber?: string
    source?: number
}

/** A DevicePropDesc either as captured bytes or as parsed fields. */
export interface ProfilePropertyDescriptor {
    raw?: string
    /** PTP datatype code ("0x0004" for UINT16, "0xffff" for STR). */
    dataType?: string
    writable?: boolean
    factoryDefault?: number | string
    current?: number | string
    form?: { range: { minimum: number; maximum: number; step: number } } | { enumeration: (number | string)[] }
}

export interface ProfileProperty {
    code: string
    name?: string
    access?: 'get' | 'get-set'
    /** The value darkgrade displayed on hardware, used to check decoding. Not used to build responses. */
    observedValue?: string
    descriptor?: ProfilePropertyDescriptor
    source: number
}

export interface RecordedExchange {
    operation: string
    name?: string
    /** Omitted when the request parameters were not captured: any parameters then match. */
    parameters?: string[]
    /** Host-to-camera data phase. Omitted data is not a wildcard for unknown write payloads. */
    dataFromHost?: string
    response: {
        code: string
        parameters?: string[]
        /** Camera-to-host data phase. */
        data?: string
    }
    note?: string
    source: number
}

export interface RecordedEvent {
    code: string
    parameters?: string[]
    /** Delivered after the response to this operation. */
    afterOperation: string
    source: number
}

/** An inclusive range of operation codes, e.g. a vendor's 0x9100-0x91ff block. */
export interface OperationRange {
    from: string
    to: string
    except?: string[]
}

/** A request identity used by an ordered prerequisite sequence. */
export interface SequenceRequest {
    operation: string
    /** Omitted means any parameters; an empty array means no parameters. */
    parameters?: string[]
}

/** Generic simulator behaviours a quirk can switch on. */
export type QuirkBehaviour =
    /** Documented for reference; no simulator behaviour. */
    | { kind: 'none' }
    /** Answers `operation` with `response` (default DeviceBusy) `times` times, counted from each `afterOperation`. */
    | { kind: 'device-busy'; operation: string; times: number; response?: string; afterOperation?: string }
    /** The device leaves the bus without a response. */
    | { kind: 'disconnect-on-request'; operation: string; parameters?: string[] }
    | { kind: 'session-id'; rule: 'nonzero' | 'equals'; sessionId?: number }
    | { kind: 'strict-transaction-ids' }
    /** Polled delivery suppresses interrupt events; `emptyResponse` answers the poll when nothing is queued. */
    | { kind: 'event-delivery'; mode: 'interrupt' | 'polled'; pollOperation?: string; emptyResponse?: string }
    | { kind: 'property-datatype'; property: string; dataType: string }
    /** Operations in `gated` answer `response` until every `unlockedBy` operation has returned OK. */
    | { kind: 'requires-operations'; unlockedBy: string[]; gated: OperationRange; response: string }
    /** Ordered successful requests. An unknown precondition response stays missing data. */
    | { kind: 'requires-sequence'; sequence: SequenceRequest[]; gated: OperationRange; response?: string }
    /** These operations are always refused with `response`. */
    | { kind: 'rejects-operations'; operations: string[]; response: string }
    /** Implemented but left out of the DeviceInfo the camera reports. */
    | { kind: 'hidden-from-device-info'; operations?: string[]; properties?: string[] }
    /** Emits `event` after `afterOperation` returns OK, optionally copying the request parameters. */
    | { kind: 'emit-event'; afterOperation: string; event: string; copyParameters?: boolean }
    /**
     * The camera also speaks standard PTP/IP on TCP `port`. Over PTP/IP its DeviceInfo reports these
     * fields instead of the USB ones (for example Sony's MTP VendorExtensionID).
     */
    | { kind: 'ptp-ip-personality'; port: number; vendorExtensionId?: string; manufacturer?: string }

export interface ProfileQuirk {
    id: string
    description: string
    source: number
    behaviour: QuirkBehaviour
    /** The source itself flags this behaviour as unconfirmed. */
    unverified?: boolean
}

/** Where a profile sits in camera-catalog/camera-lines.json, for rolling results up by line. */
export interface ProfileCatalogReference {
    manufacturer: string
    line: string
    /** Exact cited model in the catalog; never inferred from a shared USB identity or line. */
    model?: string
    /** Models in that catalog line, which this profile represents. */
    modelCount?: number
}

export interface CameraProfile {
    schemaVersion: 1
    id: string
    manufacturer: string
    /** Product line, e.g. "EOS R", "Alpha 7", "Z". */
    line: string
    model: string
    usb?: {
        vendorId: string
        productIds: string[]
        /** USB descriptor strings, which differ from the PTP DeviceInfo strings. */
        manufacturerString?: string
        productString?: string
        source?: number
    }
    firmware?: string
    catalog?: ProfileCatalogReference
    provenance: ProfileProvenance
    deviceInfo?: ProfileDeviceInfo
    properties: ProfileProperty[]
    exchanges: RecordedExchange[]
    events: RecordedEvent[]
    quirks: ProfileQuirk[]
}

const HEX_CODE = /^0x[0-9a-f]{1,8}$/
const HEX_BYTES = /^(?:[0-9a-f]{2})*$/

export function parseCode(code: string): number {
    if (!HEX_CODE.test(code)) throw new Error(`Invalid code ${code}; expected lowercase 0x-prefixed hexadecimal`)
    return Number.parseInt(code.slice(2), 16)
}

export function formatCode(code: number, digits = 4): string {
    return `0x${code.toString(16).padStart(digits, '0')}`
}

export function parseBytes(hex: string): Uint8Array {
    if (!HEX_BYTES.test(hex)) throw new Error('Invalid byte string; expected lowercase hexadecimal pairs')
    return Uint8Array.from(hex.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
}

export function formatBytes(bytes: Uint8Array): string {
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

function validateProfileStructure(profile: Partial<CameraProfile>): string[] {
    const problems: string[] = []
    const object = (value: unknown, where: string, optional = false): boolean => {
        if (optional && value === undefined) return false
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) return true
        problems.push(`${where} must be an object`)
        return false
    }
    const objects = (value: unknown, where: string): unknown[] => {
        if (!Array.isArray(value)) {
            problems.push(`${where} must be an array`)
            return []
        }
        return value.filter((entry, index) => object(entry, `${where}[${index}]`))
    }
    if (object(profile.provenance, 'provenance')) objects(profile.provenance?.sources, 'provenance.sources')
    if (object(profile.usb, 'usb', true) && !Array.isArray(profile.usb?.productIds))
        problems.push('usb.productIds must be an array')
    object(profile.catalog, 'catalog', true)
    object(profile.deviceInfo, 'deviceInfo', true)
    objects(profile.properties, 'properties').forEach((entry, index) => {
        const property = entry as ProfileProperty
        const where = `properties[${index}].descriptor`
        if (!object(property.descriptor, where, true)) return
        const form = property.descriptor?.form
        if (!object(form, `${where}.form`, true) || !form) return
        if ('range' in form) object(form.range, `${where}.form.range`)
        if ('enumeration' in form && !Array.isArray(form.enumeration))
            problems.push(`${where}.form.enumeration must be an array`)
    })
    objects(profile.exchanges, 'exchanges').forEach((entry, index) =>
        object((entry as RecordedExchange).response, `exchanges[${index}].response`)
    )
    objects(profile.events, 'events')
    objects(profile.quirks, 'quirks').forEach((entry, index) =>
        object((entry as ProfileQuirk).behaviour, `quirks[${index}].behaviour`)
    )
    return problems
}

/** Returns every problem found in a profile document; an empty list means it is valid. */
export function validateCameraProfile(document: unknown): string[] {
    const problems: string[] = []
    const profile = document as Partial<CameraProfile>
    const require = (condition: unknown, message: string) => {
        if (!condition) problems.push(message)
    }
    const checkCode = (value: unknown, where: string, maximum = 0xffffffff) => {
        if (typeof value !== 'string' || !HEX_CODE.test(value)) problems.push(`${where}: invalid code ${String(value)}`)
        else if (Number.parseInt(value.slice(2), 16) > maximum)
            problems.push(`${where}: code exceeds ${maximum === 0xffff ? 'UINT16' : 'UINT32'}`)
    }
    const checkCodes = (values: unknown, where: string, maximum = 0xffffffff) => {
        if (values === undefined) return
        if (!Array.isArray(values)) return problems.push(`${where}: expected an array`)
        values.forEach((value, index) => checkCode(value, `${where}[${index}]`, maximum))
    }
    const checkBytes = (value: unknown, where: string) => {
        if (value !== undefined && (typeof value !== 'string' || !HEX_BYTES.test(value)))
            problems.push(`${where}: invalid byte string`)
    }

    require(typeof document === 'object' && document !== null && !Array.isArray(document), 'profile must be an object')
    if (problems.length) return problems
    const structure = validateProfileStructure(profile)
    if (structure.length) return structure

    require(profile.schemaVersion === 1, 'schemaVersion must be 1')
    require(typeof profile.id === 'string' && /^[a-z0-9-]+$/.test(profile.id), 'id must be lowercase kebab-case')
    for (const field of ['manufacturer', 'line', 'model'] as const) {
        require(typeof profile[field] === 'string' && profile[field].length > 0, `${field} is required`)
    }

    const sources = profile.provenance?.sources
    require(profile.provenance?.fidelity === 'captured' ||
        profile.provenance?.fidelity === 'documented', 'provenance.fidelity must be "captured" or "documented"')
    require(Array.isArray(sources) && sources.length > 0, 'provenance.sources must list at least one source')
    const sourceCount = Array.isArray(sources) ? sources.length : 0
    sources?.forEach((source, index) =>
        require(typeof source?.location === 'string' &&
            source.location.length > 0, `provenance.sources[${index}].location is required`)
    )
    const checkSource = (value: unknown, where: string, optional = false) => {
        if (optional && value === undefined) return
        require(Number.isInteger(value) &&
            (value as number) >= 0 &&
            (value as number) < sourceCount, `${where}.source must index provenance.sources`)
    }

    if (profile.usb) {
        checkCode(profile.usb.vendorId, 'usb.vendorId', 0xffff)
        checkCodes(profile.usb.productIds, 'usb.productIds', 0xffff)
        require(profile.usb.productIds.length > 0, 'usb.productIds must not be empty')
        checkSource(profile.usb.source, 'usb', true)
    }
    if (profile.catalog?.model !== undefined)
        require(typeof profile.catalog.model === 'string' &&
            profile.catalog.model.trim().length > 0, 'catalog.model must be a nonempty string')

    const deviceInfo = profile.deviceInfo
    if (deviceInfo) {
        if (deviceInfo.listsComplete !== undefined)
            require(typeof deviceInfo.listsComplete === 'boolean', 'deviceInfo.listsComplete must be boolean')
        checkBytes(deviceInfo.raw, 'deviceInfo.raw')
        if (deviceInfo.vendorExtensionId !== undefined)
            checkCode(deviceInfo.vendorExtensionId, 'deviceInfo.vendorExtensionId')
        for (const list of [
            'operationsSupported',
            'eventsSupported',
            'devicePropertiesSupported',
            'captureFormats',
            'imageFormats',
        ] as const) {
            checkCodes(deviceInfo[list], `deviceInfo.${list}`, 0xffff)
        }
        checkSource(deviceInfo.source, 'deviceInfo', true)
    }

    for (const list of ['properties', 'exchanges', 'events', 'quirks'] as const) {
        require(Array.isArray(profile[list]), `${list} must be an array`)
    }

    profile.properties?.forEach((property, index) => {
        const where = `properties[${index}]`
        checkCode(property.code, `${where}.code`)
        checkSource(property.source, where)
        checkBytes(property.descriptor?.raw, `${where}.descriptor.raw`)
        if (property.descriptor?.dataType !== undefined)
            checkCode(property.descriptor.dataType, `${where}.descriptor.dataType`, 0xffff)
        problems.push(...validatePropertyDescriptor(property.descriptor, `${where}.descriptor`))
    })

    profile.exchanges?.forEach((exchange, index) => {
        const where = `exchanges[${index}]`
        checkCode(exchange.operation, `${where}.operation`, 0xffff)
        checkCodes(exchange.parameters, `${where}.parameters`)
        if (exchange.parameters && exchange.parameters.length > 5)
            problems.push(`${where}.parameters exceeds five PTP parameters`)
        checkBytes(exchange.dataFromHost, `${where}.dataFromHost`)
        checkCode(exchange.response?.code, `${where}.response.code`, 0xffff)
        checkCodes(exchange.response?.parameters, `${where}.response.parameters`)
        if (exchange.response.parameters && exchange.response.parameters.length > 5)
            problems.push(`${where}.response.parameters exceeds five PTP parameters`)
        checkBytes(exchange.response?.data, `${where}.response.data`)
        checkSource(exchange.source, where)
    })

    profile.events?.forEach((event, index) => {
        const where = `events[${index}]`
        checkCode(event.code, `${where}.code`, 0xffff)
        checkCodes(event.parameters, `${where}.parameters`)
        if (event.parameters && event.parameters.length > 3)
            problems.push(`${where}.parameters exceeds three PTP event parameters`)
        checkCode(event.afterOperation, `${where}.afterOperation`, 0xffff)
        checkSource(event.source, where)
    })

    const quirkIds = new Set<string>()
    profile.quirks?.forEach((quirk, index) => {
        const where = `quirks[${index}]`
        require(typeof quirk.id === 'string' && !quirkIds.has(quirk.id), `${where}.id must be unique`)
        quirkIds.add(quirk.id)
        require(typeof quirk.description === 'string', `${where}.description is required`)
        if (quirk.unverified !== undefined)
            require(typeof quirk.unverified === 'boolean', `${where}.unverified must be boolean`)
        checkSource(quirk.source, where)
        problems.push(...validateQuirkBehaviour(quirk.behaviour, `${where}.behaviour`))
    })

    return problems
}

function validatePropertyDescriptor(descriptor: ProfilePropertyDescriptor | undefined, where: string): string[] {
    if (!descriptor) return []
    const problems: string[] = []
    if (descriptor.writable !== undefined && typeof descriptor.writable !== 'boolean')
        problems.push(`${where}.writable must be boolean`)
    const value = (candidate: unknown, field: string) => {
        if (typeof candidate !== 'string' && (typeof candidate !== 'number' || !Number.isSafeInteger(candidate))) {
            problems.push(`${where}.${field} must be an integer or string`)
            return
        }
        if (descriptor.dataType === undefined || descriptor.raw !== undefined) return
        const type = Number.parseInt(descriptor.dataType.slice(2), 16)
        if (type === 0xffff) {
            if (typeof candidate !== 'string' || candidate.length > 254)
                problems.push(`${where}.${field} must be a PTP string of at most 254 UTF-16 units`)
            return
        }
        if (type < 1 || type > 10) return
        try {
            const integer = BigInt(candidate)
            const bits = 8n << BigInt(Math.floor((type - 1) / 2))
            const signed = type % 2 === 1
            const minimum = signed ? -(1n << (bits - 1n)) : 0n
            const maximum = (1n << (bits - (signed ? 1n : 0n))) - 1n
            if (integer < minimum || integer > maximum) problems.push(`${where}.${field} exceeds datatype bounds`)
        } catch {
            problems.push(`${where}.${field} is not an integer`)
        }
    }
    if (descriptor.factoryDefault !== undefined) value(descriptor.factoryDefault, 'factoryDefault')
    if (descriptor.current !== undefined) value(descriptor.current, 'current')
    const form = descriptor.form
    if (!form) return problems
    if ('range' in form === 'enumeration' in form)
        problems.push(`${where}.form must specify exactly one range or enumeration`)
    if ('enumeration' in form) {
        if (form.enumeration.length > 0xffff) problems.push(`${where}.form.enumeration exceeds UINT16 count`)
        form.enumeration.forEach((candidate, index) => value(candidate, `form.enumeration[${index}]`))
    }
    if ('range' in form) {
        const { minimum, maximum, step } = form.range
        if (![minimum, maximum, step].every(Number.isSafeInteger) || minimum > maximum || step < 0)
            problems.push(`${where}.form.range must contain ordered integer bounds and a nonnegative step`)
        value(minimum, 'form.range.minimum')
        value(maximum, 'form.range.maximum')
        value(step, 'form.range.step')
    }
    return problems
}

function validateQuirkBehaviour(behaviour: QuirkBehaviour | undefined, where: string): string[] {
    const problems: string[] = []
    const isCode = (value: unknown) => typeof value === 'string' && HEX_CODE.test(value)
    const requireCodes = (values: unknown, field: string, optional = false) => {
        if (optional && values === undefined) return
        if (!Array.isArray(values) || !values.every(isCode)) problems.push(`${where}.${field} must be codes`)
    }
    const requireCode = (value: unknown, field: string, optional = false) => {
        if (optional && value === undefined) return
        if (!isCode(value)) problems.push(`${where}.${field} is invalid`)
    }
    switch (behaviour?.kind) {
        case 'none':
        case 'strict-transaction-ids':
            break
        case 'device-busy':
            requireCode(behaviour.operation, 'operation')
            requireCode(behaviour.response, 'response', true)
            requireCode(behaviour.afterOperation, 'afterOperation', true)
            if (!Number.isInteger(behaviour.times) || behaviour.times < 1) problems.push(`${where}.times must be >= 1`)
            break
        case 'disconnect-on-request':
            requireCode(behaviour.operation, 'operation')
            requireCodes(behaviour.parameters, 'parameters', true)
            break
        case 'session-id':
            if (behaviour.rule !== 'equals' && behaviour.rule !== 'nonzero') problems.push(`${where}.rule is invalid`)
            if (behaviour.rule === 'equals' && !Number.isInteger(behaviour.sessionId))
                problems.push(`${where}.sessionId is required for rule "equals"`)
            break
        case 'event-delivery':
            if (behaviour.mode !== 'interrupt' && behaviour.mode !== 'polled') problems.push(`${where}.mode is invalid`)
            if (behaviour.mode === 'polled') requireCode(behaviour.pollOperation, 'pollOperation')
            if (behaviour.emptyResponse !== undefined && !HEX_BYTES.test(behaviour.emptyResponse))
                problems.push(`${where}.emptyResponse must be bytes`)
            break
        case 'property-datatype':
            requireCode(behaviour.property, 'property')
            requireCode(behaviour.dataType, 'dataType')
            break
        case 'requires-operations':
            requireCodes(behaviour.unlockedBy, 'unlockedBy')
            requireCode(behaviour.gated?.from, 'gated.from')
            requireCode(behaviour.gated?.to, 'gated.to')
            requireCodes(behaviour.gated?.except, 'gated.except', true)
            requireCode(behaviour.response, 'response')
            break
        case 'requires-sequence':
            if (!Array.isArray(behaviour.sequence) || !behaviour.sequence.length) {
                problems.push(`${where}.sequence must contain at least one request`)
            } else {
                behaviour.sequence.forEach((request, index) => {
                    requireCode(request?.operation, `sequence[${index}].operation`)
                    requireCodes(request?.parameters, `sequence[${index}].parameters`, true)
                })
            }
            requireCode(behaviour.gated?.from, 'gated.from')
            requireCode(behaviour.gated?.to, 'gated.to')
            requireCodes(behaviour.gated?.except, 'gated.except', true)
            requireCode(behaviour.response, 'response', true)
            break
        case 'rejects-operations':
            requireCodes(behaviour.operations, 'operations')
            requireCode(behaviour.response, 'response')
            break
        case 'hidden-from-device-info':
            requireCodes(behaviour.operations, 'operations', true)
            requireCodes(behaviour.properties, 'properties', true)
            break
        case 'emit-event':
            requireCode(behaviour.afterOperation, 'afterOperation')
            requireCode(behaviour.event, 'event')
            break
        case 'ptp-ip-personality':
            if (!Number.isInteger(behaviour.port) || behaviour.port < 1 || behaviour.port > 65535)
                problems.push(`${where}.port must be a TCP port`)
            requireCode(behaviour.vendorExtensionId, 'vendorExtensionId', true)
            if (behaviour.manufacturer !== undefined && typeof behaviour.manufacturer !== 'string')
                problems.push(`${where}.manufacturer must be a string`)
            break
        default:
            problems.push(`${where}.kind is not a known quirk behaviour`)
    }
    return problems
}

/** The profile's standard PTP/IP personality, when a quirk documents one. */
export function ptpIpPersonality(
    profile: CameraProfile
): Extract<QuirkBehaviour, { kind: 'ptp-ip-personality' }> | undefined {
    for (const { behaviour, unverified } of profile.quirks)
        if (!unverified && behaviour.kind === 'ptp-ip-personality') return behaviour
    return undefined
}

/** Parses JSON text into a validated profile, throwing with every problem listed. */
export function loadCameraProfile(json: string, origin = 'profile'): CameraProfile {
    const document: unknown = JSON.parse(json)
    const problems = validateCameraProfile(document)
    if (problems.length) throw new Error(`${origin} is invalid:\n  ${problems.join('\n  ')}`)
    return document as CameraProfile
}
