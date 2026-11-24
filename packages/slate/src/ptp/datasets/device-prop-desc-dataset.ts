import { unrecognizedValueLabel, type UnrecognizedValues } from '@camera/controls'
import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { CustomCodec, type CodecInstance, type PTPRegistry } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'

export interface DevicePropDesc {
    devicePropertyCode: number
    devicePropertyName: string
    devicePropertyDescription: string
    dataType: DatatypeCode
    getSet: 'GET' | 'GET_SET'
    factoryDefaultValue: number | bigint | string
    currentValueRaw: number | bigint | string
    currentValueBytes: Uint8Array
    currentValueDecoded: number | bigint | string
    formFlag: number
    minimumValue?: number | bigint | string
    maximumValue?: number | bigint | string
    stepSize?: number | bigint | string
    numberOfValues?: number
    supportedValuesRaw?: (number | bigint | string)[]
    supportedValuesDecoded?: (number | bigint | string)[]
    /** The property codec rejected the current value; `currentValueDecoded` then holds the raw value. */
    currentValueUnrecognized?: true
    /** Raw choices the property codec rejected; each keeps its raw value and index in `supportedValuesDecoded`. */
    unrecognizedSupportedValues?: (number | bigint | string)[]
    vendorExtensions?: {
        [key: string]: number | bigint | string | boolean | object
    }
}

/**
 * A camera can report a value its property codec does not know (newer firmware, or an enumeration
 * entry darkgrade has not named yet). The descriptor stays usable with the raw value in that slot
 * instead of failing as a whole; `undefined` marks the value unrecognized.
 */
function tryDecode(codec: CodecInstance<number | bigint | string>, bytes: Uint8Array): number | bigint | string | undefined {
    try {
        return codec.decode(bytes, 0).value
    } catch {
        return undefined
    }
}

/** Application view of a descriptor: recognized choices only, and the raw values Slate could not name. */
export function recognizedDescriptorValues(descriptor: DevicePropDesc): {
    allowedValues?: (number | bigint | string)[]
    allowedRawValues?: (number | bigint | string)[]
    unrecognized?: UnrecognizedValues
} {
    const rejected = new Set(descriptor.unrecognizedSupportedValues)
    const recognized = (_: unknown, index: number) =>
        !rejected.has(descriptor.supportedValuesRaw?.[index] as number | bigint | string)
    const unrecognized: UnrecognizedValues = {
        ...(descriptor.currentValueUnrecognized && { value: unrecognizedValueLabel(descriptor.currentValueRaw) }),
        ...(rejected.size > 0 && { choices: [...rejected].map(unrecognizedValueLabel) }),
    }
    return {
        ...(descriptor.supportedValuesDecoded && { allowedValues: descriptor.supportedValuesDecoded.filter(recognized) }),
        ...(descriptor.supportedValuesRaw && { allowedRawValues: descriptor.supportedValuesRaw.filter(recognized) }),
        ...(Object.keys(unrecognized).length > 0 && { unrecognized }),
    }
}

export class DevicePropDescCodec extends CustomCodec<DevicePropDesc> {
    private use4ByteCode: boolean

    constructor(registry: PTPRegistry, use4ByteCode: boolean = false) {
        super(registry)
        this.use4ByteCode = use4ByteCode
    }

    encode(_value: DevicePropDesc): Uint8Array {
        throw new Error('Encoding DevicePropDesc is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: DevicePropDesc; bytesRead: number } {
        let currentOffset = offset

        const headerSize = this.use4ByteCode ? 7 : 5
        if (!Number.isInteger(offset) || offset < 0 || buffer.length - offset < headerSize) {
            throw new Error('Invalid or truncated property descriptor header')
        }

        const u8 = this.registry.codecs.uint8
        const u16 = this.registry.codecs.uint16
        const u32 = this.registry.codecs.uint32

        // DevicePropCode (2 or 4 bytes)
        let devicePropertyCode: number
        if (this.use4ByteCode) {
            const result = u32.decode(buffer, currentOffset)
            devicePropertyCode = result.value
            currentOffset += result.bytesRead
        } else {
            const result = u16.decode(buffer, currentOffset)
            devicePropertyCode = result.value
            currentOffset += result.bytesRead
        }

        // DataType (2 bytes)
        const dataTypeResult = u16.decode(buffer, currentOffset)
        const dataType: DatatypeCode = dataTypeResult.value
        currentOffset += dataTypeResult.bytesRead

        // GetSet (1 byte)
        const getSetResult = u8.decode(buffer, currentOffset)
        const getSet = getSetResult.value
        if (getSet !== 0 && getSet !== 1) throw new Error(`Invalid property access flag: ${getSet}`)
        currentOffset += getSetResult.bytesRead

        const valueCodec = new VariableValueCodec(this.registry, dataType)

        // FactoryDefaultValue (variable size)
        const factoryDefaultResult = valueCodec.decode(buffer, currentOffset)
        const factoryDefaultValue = factoryDefaultResult.value.value
        currentOffset += factoryDefaultResult.bytesRead

        // CurrentValue (variable size)
        const currentValueResult = valueCodec.decode(buffer, currentOffset)
        const currentValueRaw = currentValueResult.value.value
        const currentValueBytes = currentValueResult.value.rawBytes
        currentOffset += currentValueResult.bytesRead

        // FormFlag (1 byte)
        const formFlagResult = u8.decode(buffer, currentOffset)
        const formFlag = formFlagResult.value
        if (formFlag > 2) throw new Error(`Invalid property form flag: ${formFlag}`)
        currentOffset += formFlagResult.bytesRead

        const propertyDef = Object.values(this.registry.properties).find((p: any) => p.code === devicePropertyCode)
        const devicePropertyName = propertyDef?.name || `Unknown_0x${devicePropertyCode.toString(16).padStart(4, '0')}`
        const devicePropertyDescription = propertyDef?.description || ''

        let currentValueDecoded: number | bigint | string = currentValueRaw
        let currentValueUnrecognized: true | undefined
        if (propertyDef && propertyDef.codec) {
            const codecInstance =
                typeof propertyDef.codec === 'function' ? propertyDef.codec(this.registry) : propertyDef.codec
            const decoded = tryDecode(codecInstance, currentValueBytes)
            if (decoded === undefined) currentValueUnrecognized = true
            currentValueDecoded = decoded ?? currentValueRaw
        }

        let minimumValue: number | bigint | string | undefined = undefined
        let maximumValue: number | bigint | string | undefined = undefined
        let stepSize: number | bigint | string | undefined = undefined
        let numberOfValues: number | undefined = undefined
        let supportedValuesRaw: (number | bigint | string)[] | undefined = undefined
        let supportedValuesDecoded: (number | bigint | string)[] | undefined = undefined
        const unrecognizedSupportedValues: (number | bigint | string)[] = []

        if (formFlag === 0x01) {
            const minResult = valueCodec.decode(buffer, currentOffset)
            minimumValue = minResult.value.value
            currentOffset += minResult.bytesRead

            const maxResult = valueCodec.decode(buffer, currentOffset)
            maximumValue = maxResult.value.value
            currentOffset += maxResult.bytesRead

            const stepResult = valueCodec.decode(buffer, currentOffset)
            stepSize = stepResult.value.value
            currentOffset += stepResult.bytesRead

            if (
                propertyDef &&
                propertyDef.codec &&
                minimumValue !== undefined &&
                maximumValue !== undefined &&
                stepSize !== undefined
            ) {
                const codecInstance =
                    typeof propertyDef.codec === 'function' ? propertyDef.codec(this.registry) : propertyDef.codec

                const datatypeDefinition = getDatatypeByCode(dataType)
                if (datatypeDefinition?.codec) {
                    const datatypeCodec =
                        typeof datatypeDefinition.codec === 'function'
                            ? datatypeDefinition.codec(this.registry)
                            : datatypeDefinition.codec

                    const minBytes = datatypeCodec.encode(minimumValue)
                    const maxBytes = datatypeCodec.encode(maximumValue)
                    const stepBytes = datatypeCodec.encode(stepSize)

                    minimumValue = tryDecode(codecInstance, minBytes) ?? minimumValue
                    maximumValue = tryDecode(codecInstance, maxBytes) ?? maximumValue
                    stepSize = tryDecode(codecInstance, stepBytes) ?? stepSize
                }
            }
        } else if (formFlag === 0x02) {
            const numValuesResult = u16.decode(buffer, currentOffset)
            numberOfValues = numValuesResult.value
            currentOffset += numValuesResult.bytesRead

            supportedValuesRaw = []
            for (let i = 0; i < numberOfValues; i++) {
                const enumValueResult = valueCodec.decode(buffer, currentOffset)
                supportedValuesRaw.push(enumValueResult.value.value)
                currentOffset += enumValueResult.bytesRead
            }

            supportedValuesDecoded = supportedValuesRaw
            if (propertyDef && propertyDef.codec && supportedValuesRaw && supportedValuesRaw.length > 0) {
                const codecInstance =
                    typeof propertyDef.codec === 'function' ? propertyDef.codec(this.registry) : propertyDef.codec

                const datatypeDefinition = getDatatypeByCode(dataType)
                if (datatypeDefinition?.codec) {
                    const datatypeCodec =
                        typeof datatypeDefinition.codec === 'function'
                            ? datatypeDefinition.codec(this.registry)
                            : datatypeDefinition.codec

                    supportedValuesDecoded = supportedValuesRaw.map(rawValue => {
                        const decoded = tryDecode(codecInstance, datatypeCodec.encode(rawValue))
                        if (decoded === undefined) unrecognizedSupportedValues.push(rawValue)
                        return decoded ?? rawValue
                    })
                }
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
                minimumValue,
                maximumValue,
                stepSize,
                numberOfValues,
                supportedValuesRaw,
                supportedValuesDecoded,
                ...(currentValueUnrecognized && { currentValueUnrecognized }),
                ...(unrecognizedSupportedValues.length > 0 && { unrecognizedSupportedValues }),
            },
            bytesRead: currentOffset - offset,
        }
    }
}
