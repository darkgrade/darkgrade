import { CodecDefinition, baseCodecs, CustomCodec } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { propertyDefinitions as standardPropertyDefinitions } from '@ptp/definitions/property-definitions'
import { sonyPropertyDefinitions } from '@ptp/definitions/vendors/sony/sony-property-definitions'

export interface SDIExtDevicePropInfo {
    devicePropertyCode: number
    devicePropertyName: string
    devicePropertyDescription: string
    dataType: DatatypeCode
    writable: boolean
    enabled: boolean
    factoryDefaultValue: any
    currentValueRaw: any
    currentValueBytes: Uint8Array
    currentValueDecoded: any
    formFlag: number
    enumValuesSetRaw: any[]
    enumValuesSetDecoded: any[]
    enumValuesGetSetRaw: any[]
    enumValuesGetSetDecoded: any[]
}

export interface SDIDevicePropInfoArray {
    numOfElements: number
    properties: SDIExtDevicePropInfo[]
}

class VariableValueCodec extends CustomCodec<{ value: any; rawBytes: Uint8Array }> {
    readonly type = 'custom' as const

    constructor(private dataType: DatatypeCode) {
        super()
    }

    encode(value: { value: any; rawBytes: Uint8Array } | any): Uint8Array {
        // If already has rawBytes, use them
        if (value && typeof value === 'object' && 'rawBytes' in value) {
            return value.rawBytes
        }

        // Otherwise encode the raw value
        const datatypeDefinition = getDatatypeByCode(this.dataType)
        if (!datatypeDefinition) {
            throw new Error(`Unknown datatype: 0x${this.dataType.toString(16)}`)
        }
        if (!datatypeDefinition.codec) {
            throw new Error(`Datatype ${this.dataType} has no codec`)
        }

        const codec = this.resolveBaseCodec(datatypeDefinition.codec)
        return codec.encode(value)
    }

    decode(buffer: Uint8Array, offset = 0): { value: { value: any; rawBytes: Uint8Array }; bytesRead: number } {
        const datatypeDefinition = getDatatypeByCode(this.dataType)
        if (!datatypeDefinition) {
            throw new Error(`Unknown datatype: 0x${this.dataType.toString(16)}`)
        }
        if (!datatypeDefinition.codec) {
            throw new Error(`Datatype ${this.dataType} has no codec`)
        }

        const codec = this.resolveBaseCodec(datatypeDefinition.codec)
        const result = codec.decode(buffer, offset)
        const rawBytes = buffer.slice(offset, offset + result.bytesRead)

        return {
            value: {
                value: result.value,
                rawBytes,
            },
            bytesRead: result.bytesRead,
        }
    }
}

export class SDIExtDevicePropInfoCodec extends CustomCodec<SDIExtDevicePropInfo> {
    readonly type = 'custom' as const

    encode(value: SDIExtDevicePropInfo): Uint8Array {
        throw new Error('Encoding SDIExtDevicePropInfo is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SDIExtDevicePropInfo; bytesRead: number } {
        let currentOffset = offset

        if (buffer.length < 6) {
            throw new Error(`Buffer too short: expected at least 6 bytes, got ${buffer.length}`)
        }

        const u8 = this.resolveBaseCodec(baseCodecs.uint8)
        const u16 = this.resolveBaseCodec(baseCodecs.uint16)

        const devicePropertyCodeResult = u16.decode(buffer, currentOffset)
        const devicePropertyCode = devicePropertyCodeResult.value
        currentOffset += devicePropertyCodeResult.bytesRead

        const dataTypeResult = u16.decode(buffer, currentOffset)
        const dataType = dataTypeResult.value as DatatypeCode
        currentOffset += dataTypeResult.bytesRead

        const getSetResult = u8.decode(buffer, currentOffset)
        const getSet = getSetResult.value
        currentOffset += getSetResult.bytesRead

        const isEnabledResult = u8.decode(buffer, currentOffset)
        const isEnabled = isEnabledResult.value
        currentOffset += isEnabledResult.bytesRead

        const valueCodec = new VariableValueCodec(dataType)
        valueCodec.baseCodecs = this.baseCodecs

        const factoryDefaultResult = valueCodec.decode(buffer, currentOffset)
        const factoryDefaultValue = factoryDefaultResult.value.value
        currentOffset += factoryDefaultResult.bytesRead

        const currentValueResult = valueCodec.decode(buffer, currentOffset)
        const currentValueRaw = currentValueResult.value.value
        const currentValueBytes = currentValueResult.value.rawBytes
        currentOffset += currentValueResult.bytesRead

        const formFlagResult = u8.decode(buffer, currentOffset)
        const formFlag = formFlagResult.value
        currentOffset += formFlagResult.bytesRead

        let enumValuesSet: any[] = []
        let enumValuesGetSet: any[] = []

        if (formFlag === 0x02) {
            const numEnumSetResult = u16.decode(buffer, currentOffset)
            const numEnumSet = numEnumSetResult.value
            currentOffset += numEnumSetResult.bytesRead

            for (let i = 0; i < numEnumSet; i++) {
                const enumValueResult = valueCodec.decode(buffer, currentOffset)
                enumValuesSet.push(enumValueResult.value.value)
                currentOffset += enumValueResult.bytesRead
            }

            const numEnumGetSetResult = u16.decode(buffer, currentOffset)
            const numEnumGetSet = numEnumGetSetResult.value
            currentOffset += numEnumGetSetResult.bytesRead

            for (let i = 0; i < numEnumGetSet; i++) {
                const enumValueResult = valueCodec.decode(buffer, currentOffset)
                enumValuesGetSet.push(enumValueResult.value.value)
                currentOffset += enumValueResult.bytesRead
            }
        }

        // Look up property name from definitions
        const allProperties = [...sonyPropertyDefinitions, ...standardPropertyDefinitions]
        const propertyDef = allProperties.find(p => p.code === devicePropertyCode)

        let devicePropertyName = propertyDef?.name || `Unknown_0x${devicePropertyCode.toString(16).padStart(4, '0')}`
        let devicePropertyDescription = propertyDef?.description || ''

        // Decode values using property's codec if available
        let currentValueDecoded = currentValueRaw
        let enumValuesSetDecoded = enumValuesSet
        let enumValuesGetSetDecoded = enumValuesGetSet

        if (propertyDef && propertyDef.codec) {
            // Decode current value
            const codec = propertyDef.codec as any
            // Set baseCodecs on the codec instance
            if (codec && typeof codec === 'object') {
                codec.baseCodecs = this.baseCodecs
            }
            const decodedResult = codec.decode(currentValueBytes, 0)
            currentValueDecoded = decodedResult.value

            // Decode enum values
            if (enumValuesSet.length > 0) {
                enumValuesSetDecoded = enumValuesSet.map((rawVal: any) => {
                    // Get the datatype codec to encode raw value to bytes
                    const datatypeDefinition = getDatatypeByCode(dataType)
                    if (!datatypeDefinition?.codec) return rawVal

                    const datatypeCodec = this.resolveBaseCodec(datatypeDefinition.codec)
                    const bytes = datatypeCodec.encode(rawVal)
                    const decoded = codec.decode(bytes, 0)
                    return decoded.value
                })
            }

            if (enumValuesGetSet.length > 0) {
                enumValuesGetSetDecoded = enumValuesGetSet.map((rawVal: any) => {
                    // Get the datatype codec to encode raw value to bytes
                    const datatypeDefinition = getDatatypeByCode(dataType)
                    if (!datatypeDefinition?.codec) return rawVal

                    const datatypeCodec = this.resolveBaseCodec(datatypeDefinition.codec)
                    const bytes = datatypeCodec.encode(rawVal)
                    const decoded = codec.decode(bytes, 0)
                    return decoded.value
                })
            }
        }

        return {
            value: {
                devicePropertyCode,
                devicePropertyName,
                devicePropertyDescription,
                dataType,
                writable: getSet === 0x01,
                enabled: isEnabled === 0x01 || isEnabled === 0x02,
                factoryDefaultValue,
                currentValueRaw,
                currentValueBytes,
                currentValueDecoded,
                formFlag,
                enumValuesSetRaw: enumValuesSet,
                enumValuesSetDecoded,
                enumValuesGetSetRaw: enumValuesGetSet,
                enumValuesGetSetDecoded,
            },
            bytesRead: currentOffset - offset,
        }
    }
}

export class SDIDevicePropInfoArrayCodec extends CustomCodec<SDIDevicePropInfoArray> {
    readonly type = 'custom' as const

    encode(value: SDIDevicePropInfoArray): Uint8Array {
        throw new Error('Encoding SDIDevicePropInfoArray is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SDIDevicePropInfoArray; bytesRead: number } {
        let currentOffset = offset
        const u64 = this.resolveBaseCodec(baseCodecs.uint64)

        const numOfElementsResult = u64.decode(buffer, currentOffset)
        const numOfElements = Number(numOfElementsResult.value)
        currentOffset += numOfElementsResult.bytesRead

        const properties: SDIExtDevicePropInfo[] = []
        const propCodec = new SDIExtDevicePropInfoCodec()

        for (let i = 0; i < numOfElements; i++) {
            const propResult = propCodec.decode(buffer, currentOffset)
            properties.push(propResult.value)
            currentOffset += propResult.bytesRead
        }

        return {
            value: {
                numOfElements,
                properties,
            },
            bytesRead: currentOffset - offset,
        }
    }
}

export const sdiExtDevicePropInfoCodec = new SDIExtDevicePropInfoCodec()
export const sdiDevicePropInfoArrayCodec = new SDIDevicePropInfoArrayCodec()

export function parseSDIExtDevicePropInfo(
    data: Uint8Array,
    baseCodecs?: ReturnType<typeof import('@ptp/types/codec').createBaseCodecs>
): SDIExtDevicePropInfo {
    const codec = new SDIExtDevicePropInfoCodec()
    if (baseCodecs) {
        codec.baseCodecs = baseCodecs
    }
    return codec.decode(data).value
}

export function parseSDIDevicePropInfoArray(
    data: Uint8Array,
    baseCodecs?: ReturnType<typeof import('@ptp/types/codec').createBaseCodecs>
): SDIDevicePropInfoArray {
    const codec = new SDIDevicePropInfoArrayCodec()
    if (baseCodecs) {
        codec.baseCodecs = baseCodecs
    }
    return codec.decode(data).value
}
