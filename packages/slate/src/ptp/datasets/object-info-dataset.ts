import { concatenateBytes, SequentialReader } from '@ptp/datasets/codecs/byte-sequence'
import { CustomCodec, type CodecInstance } from '@ptp/types/codec'

export interface ObjectInfo {
    storageID: number
    objectFormat: number
    objectFormatDecoded: string
    protectionStatus: number
    objectCompressedSize: number
    thumbFormat: number
    thumbFormatDecoded: string
    thumbCompressedSize: number
    thumbPixWidth: number
    thumbPixHeight: number
    imagePixWidth: number
    imagePixHeight: number
    imageBitDepth: number
    parentObject: number
    associationType: number
    associationDesc: number
    sequenceNumber: number
    filename: string
    captureDate: string
    modificationDate: string
    keywords: string
}

type WireField = 'uint16' | 'uint32' | 'string'
type WireFields = Omit<ObjectInfo, 'objectFormatDecoded' | 'thumbFormatDecoded'>

/** ObjectInfo dataset fields in wire order (PTP 1.1 table 5.5.2). */
const OBJECT_INFO_FIELDS: readonly (readonly [keyof WireFields, WireField])[] = [
    ['storageID', 'uint32'],
    ['objectFormat', 'uint16'],
    ['protectionStatus', 'uint16'],
    ['objectCompressedSize', 'uint32'],
    ['thumbFormat', 'uint16'],
    ['thumbCompressedSize', 'uint32'],
    ['thumbPixWidth', 'uint32'],
    ['thumbPixHeight', 'uint32'],
    ['imagePixWidth', 'uint32'],
    ['imagePixHeight', 'uint32'],
    ['imageBitDepth', 'uint32'],
    ['parentObject', 'uint32'],
    ['associationType', 'uint16'],
    ['associationDesc', 'uint32'],
    ['sequenceNumber', 'uint32'],
    ['filename', 'string'],
    ['captureDate', 'string'],
    ['modificationDate', 'string'],
    ['keywords', 'string'],
]

export class ObjectInfoCodec extends CustomCodec<ObjectInfo> {
    private wireCodecs(): Record<WireField, CodecInstance<number | string>> {
        const { uint16, uint32, string } = this.registry.codecs
        return { uint16, uint32, string }
    }

    encode(value: ObjectInfo): Uint8Array {
        const codecs = this.wireCodecs()
        return concatenateBytes(OBJECT_INFO_FIELDS.map(([name, type]) => codecs[type].encode(value[name])))
    }

    decode(buffer: Uint8Array, offset = 0): { value: ObjectInfo; bytesRead: number } {
        const codecs = this.wireCodecs()
        const reader = new SequentialReader(buffer, offset)
        const fields: Record<string, number | string> = {}
        for (const [name, type] of OBJECT_INFO_FIELDS) fields[name] = reader.read(codecs[type])
        const info = fields as WireFields
        const formatName = (code: number) =>
            Object.values(this.registry.formats).find((f: any) => f.code === code)?.name
        return {
            value: {
                ...info,
                objectFormatDecoded: formatName(info.objectFormat) || `Unknown_0x${info.objectFormat.toString(16)}`,
                thumbFormatDecoded:
                    formatName(info.thumbFormat) ||
                    (info.thumbFormat === 0 ? 'None' : `Unknown_0x${info.thumbFormat.toString(16)}`),
            },
            bytesRead: reader.bytesRead,
        }
    }
}
