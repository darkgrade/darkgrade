import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'
import { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { CustomCodec } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'

/**
 * Sony-specific device property descriptor extensions
 * Extends the standard DevicePropDesc with Sony-specific features
 */
export interface SonyDevicePropDesc extends DevicePropDesc {
    vendorExtensions: {
        enabled: boolean
        // Sony provides two sets of enum values: one for display (Set) and one for actual Get/Set operations
        enumValuesSet?: {
            raw: (number | bigint | string)[]
            decoded: (number | bigint | string)[]
        }
        enumValuesGetSet?: {
            raw: (number | bigint | string)[]
            decoded: (number | bigint | string)[]
        }
    }
}

export interface SDIDevicePropInfoArray {
    numOfElements: number
    properties: SonyDevicePropDesc[]
}

export class SDIExtDevicePropInfoCodec extends CustomCodec<SonyDevicePropDesc> {
    encode(value: SonyDevicePropDesc): Uint8Array {
        throw new Error('Encoding SonyDevicePropDesc is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SonyDevicePropDesc; bytesRead: number } {
        let currentOffset = offset

        if (buffer.length < 6) {
            throw new Error(`Buffer too short: expected at least 6 bytes, got ${buffer.length}`)
        }

        const u8 = this.registry.codecs.uint8
        const u16 = this.registry.codecs.uint16

        const devicePropertyCodeResult = u16.decode(buffer, currentOffset)
        const devicePropertyCode = devicePropertyCodeResult.value
        currentOffset += devicePropertyCodeResult.bytesRead

        const dataTypeResult = u16.decode(buffer, currentOffset)
        const dataType: DatatypeCode = dataTypeResult.value
        currentOffset += dataTypeResult.bytesRead

        const getSetResult = u8.decode(buffer, currentOffset)
        const getSet = getSetResult.value
        currentOffset += getSetResult.bytesRead

        const isEnabledResult = u8.decode(buffer, currentOffset)
        const isEnabled = isEnabledResult.value
        currentOffset += isEnabledResult.bytesRead

        const valueCodec = new VariableValueCodec(this.registry, dataType)

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

        const enumValuesSet: (number | bigint | string)[] = []
        const enumValuesGetSet: (number | bigint | string)[] = []

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

        const propertyDef = Object.values(this.registry.properties).find((p: any) => p.code === devicePropertyCode)

        const devicePropertyName = propertyDef?.name || `Unknown_0x${devicePropertyCode.toString(16).padStart(4, '0')}`
        const devicePropertyDescription = propertyDef?.description || ''

        let currentValueDecoded: number | bigint | string = currentValueRaw
        let enumValuesSetDecoded: (number | bigint | string)[] = enumValuesSet
        let enumValuesGetSetDecoded: (number | bigint | string)[] = enumValuesGetSet

        if (propertyDef && propertyDef.codec && currentValueBytes.length > 0) {
            const codecInstance =
                typeof propertyDef.codec === 'function' ? propertyDef.codec(this.registry) : propertyDef.codec

            try {
                const decodedResult = codecInstance.decode(currentValueBytes, 0)
                currentValueDecoded = decodedResult.value
            } catch (e) {}

            if (enumValuesSet.length > 0) {
                enumValuesSetDecoded = enumValuesSet.map(rawVal => {
                    try {
                        const datatypeDefinition = getDatatypeByCode(dataType)
                        if (!datatypeDefinition?.codec) return rawVal

                        const datatypeCodec =
                            typeof datatypeDefinition.codec === 'function'
                                ? datatypeDefinition.codec(this.registry)
                                : datatypeDefinition.codec

                        const bytes = datatypeCodec.encode(rawVal)
                        const decoded = codecInstance.decode(bytes, 0)
                        return decoded.value
                    } catch (e) {
                        return rawVal
                    }
                })
            }

            if (enumValuesGetSet.length > 0) {
                enumValuesGetSetDecoded = enumValuesGetSet.map(rawVal => {
                    try {
                        const datatypeDefinition = getDatatypeByCode(dataType)
                        if (!datatypeDefinition?.codec) return rawVal

                        const datatypeCodec =
                            typeof datatypeDefinition.codec === 'function'
                                ? datatypeDefinition.codec(this.registry)
                                : datatypeDefinition.codec

                        const bytes = datatypeCodec.encode(rawVal)
                        const decoded = codecInstance.decode(bytes, 0)
                        return decoded.value
                    } catch (e) {
                        return rawVal
                    }
                })
            }
        }

        return {
            value: {
                devicePropertyCode,
                devicePropertyName,
                devicePropertyDescription,
                dataType,
                getSet: getSet === 0x01 ? 'GET_SET' : 'GET',
                factoryDefaultValue,
                currentValueRaw,
                currentValueBytes,
                currentValueDecoded,
                formFlag,
                numberOfValues: enumValuesSet.length,
                supportedValuesRaw: enumValuesSet,
                supportedValuesDecoded: enumValuesSetDecoded,
                vendorExtensions: {
                    enabled: isEnabled === 0x01 || isEnabled === 0x02,
                    enumValuesSet: {
                        raw: enumValuesSet,
                        decoded: enumValuesSetDecoded,
                    },
                    enumValuesGetSet: {
                        raw: enumValuesGetSet,
                        decoded: enumValuesGetSetDecoded,
                    },
                },
            },
            bytesRead: currentOffset - offset,
        }
    }
}

export class SDIDevicePropInfoArrayCodec extends CustomCodec<SDIDevicePropInfoArray> {
    encode(value: SDIDevicePropInfoArray): Uint8Array {
        throw new Error('Encoding SDIDevicePropInfoArray is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SDIDevicePropInfoArray; bytesRead: number } {
        let currentOffset = offset
        const u64 = this.registry.codecs.uint64

        const numOfElementsResult = u64.decode(buffer, currentOffset)
        const numOfElements = Number(numOfElementsResult.value)
        currentOffset += numOfElementsResult.bytesRead

        const properties: SonyDevicePropDesc[] = []
        const propCodec = new SDIExtDevicePropInfoCodec(this.registry)

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
