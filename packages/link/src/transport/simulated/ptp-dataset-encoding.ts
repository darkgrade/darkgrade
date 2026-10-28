import { parseCode, type ProfileDeviceInfo, type ProfilePropertyDescriptor } from '@transport/simulated/camera-profile'

/**
 * Little-endian PTP dataset encoding for SimulatedTransport.
 *
 * Deliberately independent of darkgrade's codecs: the simulator stands in for a camera, so
 * reusing the decoder's own encoders would hide symmetric bugs.
 */

const STRING_DATATYPE = 0xffff
const INTEGER_SIZES: Record<number, { bytes: number; signed: boolean }> = {
    0x0001: { bytes: 1, signed: true },
    0x0002: { bytes: 1, signed: false },
    0x0003: { bytes: 2, signed: true },
    0x0004: { bytes: 2, signed: false },
    0x0005: { bytes: 4, signed: true },
    0x0006: { bytes: 4, signed: false },
    0x0007: { bytes: 8, signed: true },
    0x0008: { bytes: 8, signed: false },
    0x0009: { bytes: 16, signed: true },
    0x000a: { bytes: 16, signed: false },
}

export function concatenateBytes(parts: Uint8Array[]): Uint8Array {
    const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        output.set(part, offset)
        offset += part.length
    }
    return output
}

export function encodeUint16(value: number): Uint8Array {
    const bytes = new Uint8Array(2)
    new DataView(bytes.buffer).setUint16(0, value, true)
    return bytes
}

export function encodeUint32(value: number): Uint8Array {
    const bytes = new Uint8Array(4)
    new DataView(bytes.buffer).setUint32(0, value >>> 0, true)
    return bytes
}

/** PTP string: character count including the terminator, then UTF-16LE; empty is a single zero byte. */
export function encodePtpString(text: string): Uint8Array {
    if (text.length === 0) return Uint8Array.of(0)
    const characterCount = text.length + 1
    if (characterCount > 255) throw new Error('PTP strings hold at most 254 characters')
    const bytes = new Uint8Array(1 + characterCount * 2)
    const view = new DataView(bytes.buffer)
    bytes[0] = characterCount
    for (let index = 0; index < text.length; index++) view.setUint16(1 + index * 2, text.charCodeAt(index), true)
    return bytes
}

function encodeUint16Array(codes: string[]): Uint8Array {
    return concatenateBytes([encodeUint32(codes.length), ...codes.map(code => encodeUint16(parseCode(code)))])
}

export function encodeValue(dataType: number, value: number | string): Uint8Array {
    if (dataType === STRING_DATATYPE) {
        if (typeof value !== 'string') throw new Error('PTP string values must be strings')
        return encodePtpString(value)
    }
    const size = INTEGER_SIZES[dataType]
    if (!size) throw new Error(`Datatype 0x${dataType.toString(16)} is not supported by the simulator`)
    if (typeof value === 'number' && !Number.isSafeInteger(value))
        throw new Error('PTP integer values must be safe integers; use a decimal string for larger values')
    const bytes = new Uint8Array(size.bytes)
    const integer = BigInt(value)
    const bits = BigInt(size.bytes * 8)
    const minimum = size.signed ? -(1n << (bits - 1n)) : 0n
    const maximum = (1n << (bits - (size.signed ? 1n : 0n))) - 1n
    if (integer < minimum || integer > maximum) throw new Error(`PTP integer ${value} exceeds datatype bounds`)
    let remaining = BigInt.asUintN(size.bytes * 8, integer)
    for (let index = 0; index < size.bytes; index++) {
        bytes[index] = Number(remaining & 0xffn)
        remaining >>= 8n
    }
    return bytes
}

function requireBytes(bytes: Uint8Array, offset: number, count: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset + count > bytes.length)
        throw new Error('Truncated PTP dataset')
}

/** Byte length of one value of `dataType` starting at `offset`. */
export function valueLength(dataType: number, bytes: Uint8Array, offset: number): number {
    if (dataType === STRING_DATATYPE) {
        requireBytes(bytes, offset, 1)
        const characterCount = bytes[offset]
        const length = 1 + characterCount * 2
        requireBytes(bytes, offset, length)
        if (characterCount && (bytes[offset + length - 2] !== 0 || bytes[offset + length - 1] !== 0))
            throw new Error('PTP string is missing its terminator')
        return length
    }
    if ((dataType & 0x4000) !== 0) {
        const element = INTEGER_SIZES[dataType & ~0x4000]
        if (!element) throw new Error(`Unsupported PTP array datatype 0x${dataType.toString(16)}`)
        requireBytes(bytes, offset, 4)
        const count = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
        const length = 4 + count * element.bytes
        requireBytes(bytes, offset, length)
        return length
    }
    const size = INTEGER_SIZES[dataType]
    if (!size) throw new Error(`Datatype 0x${dataType.toString(16)} is not supported by the simulator`)
    requireBytes(bytes, offset, size.bytes)
    return size.bytes
}

function readInteger(dataType: number, bytes: Uint8Array): bigint {
    const size = INTEGER_SIZES[dataType]
    if (!size) throw new Error('PTP ranges require a scalar integer datatype')
    let value = 0n
    for (let index = size.bytes - 1; index >= 0; index--) value = (value << 8n) | BigInt(bytes[index])
    return size.signed ? BigInt.asIntN(size.bytes * 8, value) : value
}

/**
 * Encodes a DeviceInfo dataset from parsed fields. Returns undefined unless the operation,
 * event and property lists and the manufacturer/model strings are all present; the remaining
 * fields fall back to protocol-neutral empty values.
 */
export function encodeDeviceInfo(deviceInfo: ProfileDeviceInfo): Uint8Array | undefined {
    const { operationsSupported, eventsSupported, devicePropertiesSupported, manufacturer, model } = deviceInfo
    if (!operationsSupported || !eventsSupported || !devicePropertiesSupported) return undefined
    if (manufacturer === undefined || model === undefined) return undefined
    return concatenateBytes([
        encodeUint16(deviceInfo.standardVersion ?? 100),
        encodeUint32(deviceInfo.vendorExtensionId ? parseCode(deviceInfo.vendorExtensionId) : 0),
        encodeUint16(deviceInfo.vendorExtensionVersion ?? 0),
        encodePtpString(deviceInfo.vendorExtensionDescription ?? ''),
        encodeUint16(deviceInfo.functionalMode ?? 0),
        encodeUint16Array(operationsSupported),
        encodeUint16Array(eventsSupported),
        encodeUint16Array(devicePropertiesSupported),
        encodeUint16Array(deviceInfo.captureFormats ?? []),
        encodeUint16Array(deviceInfo.imageFormats ?? []),
        encodePtpString(manufacturer),
        encodePtpString(model),
        encodePtpString(deviceInfo.deviceVersion ?? ''),
        encodePtpString(deviceInfo.serialNumber ?? ''),
    ])
}

/** The parts of a DevicePropDesc the simulator reads and rewrites. */
export interface DescriptorLayout {
    dataType: number
    writable: boolean
    currentValueStart: number
    currentValueEnd: number
    enumeration?: Uint8Array[]
    range?: { minimum: bigint; maximum: bigint; step: bigint }
}

export function readDescriptorLayout(raw: Uint8Array): DescriptorLayout {
    requireBytes(raw, 0, 5)
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const dataType = view.getUint16(2, true)
    const writable = raw[4] === 1
    const factoryDefaultStart = 5
    const currentValueStart = factoryDefaultStart + valueLength(dataType, raw, factoryDefaultStart)
    const currentValueEnd = currentValueStart + valueLength(dataType, raw, currentValueStart)
    const formFlag = raw[currentValueEnd]
    requireBytes(raw, currentValueEnd, 1)
    if (raw[4] !== 0 && raw[4] !== 1) throw new Error('Invalid DevicePropDesc access flag')
    const layout: DescriptorLayout = { dataType, writable, currentValueStart, currentValueEnd }
    if (formFlag === 0) return layout
    if (formFlag === 1) {
        let offset = currentValueEnd + 1
        const values: bigint[] = []
        for (let index = 0; index < 3; index++) {
            const length = valueLength(dataType, raw, offset)
            values.push(readInteger(dataType, raw.slice(offset, offset + length)))
            offset += length
        }
        const [minimum, maximum, step] = values
        if (minimum > maximum || step < 0n) throw new Error('Invalid DevicePropDesc range')
        return { ...layout, range: { minimum, maximum, step } }
    }
    if (formFlag !== 2) throw new Error('Invalid DevicePropDesc form flag')

    requireBytes(raw, currentValueEnd + 1, 2)
    const count = view.getUint16(currentValueEnd + 1, true)
    const enumeration: Uint8Array[] = []
    let offset = currentValueEnd + 3
    for (let index = 0; index < count; index++) {
        const length = valueLength(dataType, raw, offset)
        enumeration.push(raw.slice(offset, offset + length))
        offset += length
    }
    return { ...layout, enumeration }
}

/** Validates the complete wire value against the descriptor's datatype and advertised form. */
export function descriptorAcceptsValue(layout: DescriptorLayout, value: Uint8Array): boolean {
    try {
        if (valueLength(layout.dataType, value, 0) !== value.length) return false
        if (
            layout.enumeration &&
            !layout.enumeration.some(
                allowed => allowed.length === value.length && allowed.every((byte, index) => value[index] === byte)
            )
        )
            return false
        if (!layout.range) return true
        const integer = readInteger(layout.dataType, value)
        const { minimum, maximum, step } = layout.range
        return integer >= minimum && integer <= maximum && (step === 0n || (integer - minimum) % step === 0n)
    } catch {
        return false
    }
}

/** Encodes a DevicePropDesc from parsed fields, or undefined when a required field is missing. */
export function encodeDescriptor(
    code: number,
    descriptor: ProfilePropertyDescriptor,
    dataTypeOverride?: number
): Uint8Array | undefined {
    const { dataType, writable, factoryDefault, current, form } = descriptor
    if (dataType === undefined || writable === undefined || factoryDefault === undefined || current === undefined)
        return undefined
    const type = dataTypeOverride ?? parseCode(dataType)
    if (!Number.isInteger(code) || code < 0 || code > 0xffff) throw new Error('DevicePropDesc code exceeds UINT16')
    const formBytes: Uint8Array[] = [Uint8Array.of(0)]
    if (form && 'range' in form) {
        formBytes[0] = Uint8Array.of(1)
        formBytes.push(
            encodeValue(type, form.range.minimum),
            encodeValue(type, form.range.maximum),
            encodeValue(type, form.range.step)
        )
    }
    if (form && 'enumeration' in form) {
        if (form.enumeration.length > 0xffff) throw new Error('DevicePropDesc enumeration exceeds UINT16 count')
        formBytes[0] = Uint8Array.of(2)
        formBytes.push(
            encodeUint16(form.enumeration.length),
            ...form.enumeration.map(value => encodeValue(type, value))
        )
    }
    return concatenateBytes([
        encodeUint16(code),
        encodeUint16(type),
        Uint8Array.of(writable ? 1 : 0),
        encodeValue(type, factoryDefault),
        encodeValue(type, current),
        ...formBytes,
    ])
}
