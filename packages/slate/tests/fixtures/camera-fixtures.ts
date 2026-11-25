import { Camera } from '@camera/index'
import { protocolSession } from '@camera/protocol-session'
import { DeviceInfoCodec, type DeviceInfo } from '@ptp/datasets/device-info-dataset'
import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfoCodec, type ObjectInfo } from '@ptp/datasets/object-info-dataset'
import type { PTPRegistry } from '@ptp/types/codec'
import { SDIDevicePropInfoArrayCodec } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'

/** A transport that is connected and little-endian; each test answers transactions itself. */
export const fakeTransport = (members: Record<string, unknown> = {}) =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined, ...members }) as unknown as TransportInterface

export function concatenate(parts: Uint8Array[]): Uint8Array {
    const wire = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
    let offset = 0
    for (const part of parts) {
        wire.set(part, offset)
        offset += part.length
    }
    return wire
}

/**
 * A JPEG of `size` bytes whose markers walk as a camera's do, with no decodable picture: SOI, an APP1
 * holding an embedded thumbnail (its own FF D9), a quantization table, a scan whose data has stuffed
 * zeros (FF 00) and a restart marker (FF D0), then EOI.
 */
export function syntheticJpeg(size: number): Uint8Array {
    const segments = [
        Uint8Array.of(0xff, 0xd8),
        Uint8Array.of(0xff, 0xe1, 0x00, 0x08, 0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9),
        concatenate([Uint8Array.of(0xff, 0xdb, 0x00, 0x43), new Uint8Array(0x41).fill(0x01)]),
        Uint8Array.of(0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00),
    ]
    const header = concatenate(segments)
    const scan = new Uint8Array(size - header.length - 2).fill(0x11)
    scan.set([0xff, 0x00], 4)
    scan.set([0xff, 0xd0], scan.length >> 1)
    return concatenate([header, scan, Uint8Array.of(0xff, 0xd9)])
}

/** A DeviceInfo as the real codec of the camera's (or registry's) protocol decodes it from the wire. */
export function encodedDeviceInfo(source: Camera | PTPRegistry, fields: Partial<DeviceInfo> = {}): DeviceInfo {
    const codec = new DeviceInfoCodec(source instanceof Camera ? protocolSession(source).driver.registry : source)
    return codec.decode(
        codec.encode({
            standardVersion: 100,
            vendorExtensionID: 0,
            vendorExtensionVersion: 100,
            vendorExtensionDesc: '',
            functionalMode: 0,
            operationsSupportedRaw: [0x1001],
            operationsSupportedDecoded: [],
            eventsSupportedRaw: [],
            eventsSupportedDecoded: [],
            devicePropertiesSupported: [],
            devicePropertiesSupportedDecoded: [],
            captureFormats: [],
            imageFormatsRaw: [],
            imageFormatsDecoded: [],
            manufacturer: 'Fixture',
            model: 'Fixture',
            deviceVersion: '1',
            serialNumber: '',
            ...fields,
        })
    ).value
}

/** The common test shape: the camera's DeviceInfo advertising these properties and operations. */
export const deviceInfo = (camera: Camera, properties: number[], operations: number[]) =>
    encodedDeviceInfo(camera, { devicePropertiesSupported: properties, operationsSupportedRaw: operations })

const integerCodecNames = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32'] as const

/** The integer codec of a PTP datatype code, 1 (INT8) to 6 (UINT32). */
export function integerCodec(registry: PTPRegistry, datatype: number) {
    const name = integerCodecNames[datatype - 1]
    if (!name) throw new Error(`No integer codec for datatype ${datatype}`)
    return registry.codecs[name]
}

/** One simulated standard property descriptor: an enumeration (`choices`), a range, or neither. */
export interface PropertyDescriptorRecord {
    code: number
    datatype: number
    current: number | string
    choices?: readonly (number | string)[]
    /** Minimum, maximum and step. */
    range?: readonly number[]
    /** Default true. */
    writable?: boolean
}

/** One simulated Sony SDIO property: a descriptor with its enabled state. */
export interface SonyPropertyRecord extends PropertyDescriptorRecord {
    /** 1 enabled (the default), 2 disabled, 0 display only. */
    enabled?: number
    /** Repeat the choice list as the settable list, as newer bodies send it. */
    settableChoices?: boolean
}

/** A property's current value twice (default and current) and its form: 1 range, 2 enumeration, 0 none. */
function valueAndForm(registry: PTPRegistry, record: PropertyDescriptorRecord, settableChoices = false): Uint8Array[] {
    const { uint8, uint16 } = registry.codecs
    const codec = new VariableValueCodec(registry, record.datatype)
    const encode = (value: number | string) => codec.encode(value)
    const values = [encode(record.current), encode(record.current)]
    if (record.range) return [...values, uint8.encode(1), ...record.range.map(encode)]
    if (!record.choices) return [...values, uint8.encode(0)]
    const list = [uint16.encode(record.choices.length), ...record.choices.map(encode)]
    return [...values, uint8.encode(2), ...list, ...(settableChoices ? list : [])]
}

/** An SDIO_GetAllExtDevicePropInfo reply, encoded and decoded with the real codec. */
export function sonyPropertyInventory(registry: PTPRegistry, records: readonly SonyPropertyRecord[]) {
    const { uint8, uint16, uint32 } = registry.codecs
    const parts = [uint32.encode(records.length), uint32.encode(0)]
    for (const record of records)
        parts.push(
            uint16.encode(record.code),
            uint16.encode(record.datatype),
            uint8.encode(record.writable === false ? 0 : 1),
            uint8.encode(record.enabled ?? 1),
            ...valueAndForm(registry, record, record.settableChoices)
        )
    return new SDIDevicePropInfoArrayCodec(registry).decode(concatenate(parts)).value
}

/** A GetDevicePropDesc reply decoded with the real codec; `extended` is Nikon's 32-bit property code form. */
export function propertyDescriptor(registry: PTPRegistry, record: PropertyDescriptorRecord, extended = false) {
    const { uint8, uint16, uint32 } = registry.codecs
    const wire = concatenate([
        extended ? uint32.encode(record.code) : uint16.encode(record.code),
        uint16.encode(record.datatype),
        uint8.encode(record.writable === false ? 0 : 1),
        ...valueAndForm(registry, record),
    ])
    return new DevicePropDescCodec(registry, extended).decode(wire).value
}

/** An ObjectInfo reply on the first card storage, as the real codec decodes it from the wire. */
export function encodedObjectInfo(registry: PTPRegistry, fields: Partial<ObjectInfo>): ObjectInfo {
    const codec = new ObjectInfoCodec(registry)
    return codec.decode(
        codec.encode({
            storageID: 0x00010001,
            objectFormat: 0x3801,
            objectFormatDecoded: '',
            protectionStatus: 0,
            objectCompressedSize: 0,
            thumbFormat: 0,
            thumbFormatDecoded: '',
            thumbCompressedSize: 0,
            thumbPixWidth: 0,
            thumbPixHeight: 0,
            imagePixWidth: 0,
            imagePixHeight: 0,
            imageBitDepth: 0,
            parentObject: 0,
            associationType: 0,
            associationDesc: 0,
            sequenceNumber: 0,
            filename: '',
            captureDate: '',
            modificationDate: '',
            keywords: '',
            ...fields,
        })
    ).value
}

/** A Nikon GetVendorCodes reply: the count, then each 32-bit code. */
export const vendorCodeList = (registry: PTPRegistry, codes: readonly number[]) =>
    concatenate([registry.codecs.uint32.encode(codes.length), ...codes.map(code => registry.codecs.uint32.encode(code))])
