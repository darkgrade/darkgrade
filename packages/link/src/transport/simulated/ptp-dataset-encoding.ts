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
    if (dataType === STRING_DATATYPE) return encodePtpString(String(value))
    const size = INTEGER_SIZES[dataType]
    if (!size) throw new Error(`Datatype 0x${dataType.toString(16)} is not supported by the simulator`)
    const bytes = new Uint8Array(size.bytes)
    const view = new DataView(bytes.buffer)
    const integer = BigInt(value)
    if (size.bytes === 8) {
        if (size.signed) view.setBigInt64(0, integer, true)
        else view.setBigUint64(0, integer, true)
        return bytes
    }
    const numeric = Number(integer)
    if (size.bytes === 1) view.setUint8(0, numeric & 0xff)
    if (size.bytes === 2) view.setUint16(0, numeric & 0xffff, true)
    if (size.bytes === 4) view.setUint32(0, numeric >>> 0, true)
    return bytes
}

/** Byte length of one value of `dataType` starting at `offset`. */
export function valueLength(dataType: number, bytes: Uint8Array, offset: number): number {
    if (dataType === STRING_DATATYPE) {
        const characterCount = bytes[offset]
        if (characterCount === undefined) throw new Error('Truncated PTP string')
        return 1 + characterCount * 2
    }
    const size = INTEGER_SIZES[dataType]
    if (!size) throw new Error(`Datatype 0x${dataType.toString(16)} is not supported by the simulator`)
    return size.bytes
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
}

export function readDescriptorLayout(raw: Uint8Array): DescriptorLayout {
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
    const dataType = view.getUint16(2, true)
    const writable = raw[4] === 1
    const factoryDefaultStart = 5
    const currentValueStart = factoryDefaultStart + valueLength(dataType, raw, factoryDefaultStart)
    const currentValueEnd = currentValueStart + valueLength(dataType, raw, currentValueStart)
    const formFlag = raw[currentValueEnd]
    const layout: DescriptorLayout = { dataType, writable, currentValueStart, currentValueEnd }
    if (formFlag !== 0x02) return layout

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
