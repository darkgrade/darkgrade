import { concatenateBytes, SequentialReader } from '@ptp/datasets/codecs/byte-sequence'
import { ArrayCodec, CustomCodec } from '@ptp/types/codec'

export interface DeviceInfo {
    standardVersion: number
    vendorExtensionID: number
    vendorExtensionVersion: number
    vendorExtensionDesc: string
    functionalMode: number
    operationsSupportedRaw: number[]
    operationsSupportedDecoded: string[]
    eventsSupportedRaw: number[]
    eventsSupportedDecoded: string[]
    devicePropertiesSupported: number[]
    devicePropertiesSupportedDecoded: string[]
    captureFormats: number[]
    imageFormatsRaw: number[]
    imageFormatsDecoded: string[]
    manufacturer: string
    model: string
    deviceVersion: string
    serialNumber: string
}

export class DeviceInfoCodec extends CustomCodec<DeviceInfo> {
    encode(value: DeviceInfo): Uint8Array {
        const { uint16, uint32, string } = this.registry.codecs
        const codes = new ArrayCodec(this.registry, uint16)
        return concatenateBytes([
            uint16.encode(value.standardVersion),
            uint32.encode(value.vendorExtensionID),
            uint16.encode(value.vendorExtensionVersion),
            string.encode(value.vendorExtensionDesc),
            uint16.encode(value.functionalMode),
            codes.encode(value.operationsSupportedRaw),
            codes.encode(value.eventsSupportedRaw),
            codes.encode(value.devicePropertiesSupported),
            codes.encode(value.captureFormats),
            codes.encode(value.imageFormatsRaw),
            string.encode(value.manufacturer),
            string.encode(value.model),
            string.encode(value.deviceVersion),
            string.encode(value.serialNumber),
        ])
    }

    decode(buffer: Uint8Array, offset = 0): { value: DeviceInfo; bytesRead: number } {
        const { uint16, uint32, string } = this.registry.codecs
        const codes = new ArrayCodec(this.registry, uint16)
        const reader = new SequentialReader(buffer, offset)
        const standardVersion = reader.read(uint16)
        const vendorExtensionID = reader.read(uint32)
        const vendorExtensionVersion = reader.read(uint16)
        const vendorExtensionDesc = reader.read(string)
        const functionalMode = reader.read(uint16)
        const operationsSupported = reader.read(codes)
        const eventsSupported = reader.read(codes)
        const devicePropertiesSupported = reader.read(codes)
        const captureFormats = reader.read(codes)
        const imageFormats = reader.read(codes)
        const names = (definitions: Record<string, any>, values: number[]) =>
            values.map(code => {
                const definition = Object.values(definitions).find((candidate: any) => candidate.code === code)
                return definition?.name || `Unknown_0x${code.toString(16)}`
            })
        return {
            value: {
                standardVersion,
                vendorExtensionID,
                vendorExtensionVersion,
                vendorExtensionDesc,
                functionalMode,
                operationsSupportedRaw: operationsSupported,
                operationsSupportedDecoded: names(this.registry.operations, operationsSupported),
                eventsSupportedRaw: eventsSupported,
                eventsSupportedDecoded: names(this.registry.events, eventsSupported),
                devicePropertiesSupported,
                devicePropertiesSupportedDecoded: names(this.registry.properties, devicePropertiesSupported),
                captureFormats,
                imageFormatsRaw: imageFormats,
                imageFormatsDecoded: names(this.registry.formats, imageFormats),
                manufacturer: reader.read(string),
                model: reader.read(string),
                deviceVersion: reader.read(string),
                serialNumber: reader.read(string),
            },
            bytesRead: reader.bytesRead,
        }
    }
}
