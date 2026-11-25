import type { UnrecognizedValues } from '@camera/controls'
import { SequentialReader } from '@ptp/datasets/codecs/byte-sequence'
import { VariableValueCodec, type VariableValue } from '@ptp/datasets/codecs/variable-value-codec'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { CustomCodec, type CodecDefinition, type CodecInstance, type PTPRegistry } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'

type DescriptorValue = number | bigint | string

/** Hexadecimal for integers (`0x1234`), verbatim for text. */
export function unrecognizedValueLabel(raw: number | bigint | string): string {
    if (typeof raw === 'string') return raw
    return raw < 0 ? `-0x${(-raw).toString(16)}` : `0x${raw.toString(16)}`
}

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
function tryDecode(codec: CodecInstance<DescriptorValue>, bytes: Uint8Array): DescriptorValue | undefined {
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
        ...(descriptor.supportedValuesDecoded && {
            allowedValues: descriptor.supportedValuesDecoded.filter(recognized),
        }),
        ...(descriptor.supportedValuesRaw && { allowedRawValues: descriptor.supportedValuesRaw.filter(recognized) }),
        ...(Object.keys(unrecognized).length > 0 && { unrecognized }),
    }
}

export class DevicePropDescCodec extends CustomCodec<DevicePropDesc> {
    constructor(
        registry: PTPRegistry,
        private use4ByteCode: boolean = false
    ) {
        super(registry)
    }

    encode(_value: DevicePropDesc): Uint8Array {
        throw new Error('Encoding DevicePropDesc is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: DevicePropDesc; bytesRead: number } {
        if (!Number.isInteger(offset) || offset < 0 || buffer.length - offset < (this.use4ByteCode ? 7 : 5))
            throw new Error('Invalid or truncated property descriptor header')
        const reader = new SequentialReader(buffer, offset)
        const { uint8, uint16, uint32 } = this.registry.codecs
        const devicePropertyCode = reader.read(this.use4ByteCode ? uint32 : uint16)
        const dataType: DatatypeCode = reader.read(uint16)
        const getSet = reader.read(uint8)
        if (getSet !== 0 && getSet !== 1) throw new Error(`Invalid property access flag: ${getSet}`)
        const valueCodec = new VariableValueCodec(this.registry, dataType)
        const readVariableValue = () => reader.read<VariableValue>(valueCodec)
        const readValue = () => readVariableValue().value
        const factoryDefaultValue = readValue()
        const { value: currentValueRaw, rawBytes: currentValueBytes } = readVariableValue()
        const formFlag = reader.read(uint8)
        if (formFlag > 2) throw new Error(`Invalid property form flag: ${formFlag}`)

        const propertyDef = Object.values(this.registry.properties).find((p: any) => p.code === devicePropertyCode)
        const devicePropertyName = propertyDef?.name || `Unknown_0x${devicePropertyCode.toString(16).padStart(4, '0')}`
        const devicePropertyDescription = propertyDef?.description || ''
        const resolve = <Value>(codec: CodecDefinition<Value>) =>
            typeof codec === 'function' ? codec(this.registry) : codec
        const propertyCodec = propertyDef?.codec ? resolve<DescriptorValue>(propertyDef.codec) : undefined
        const datatypeCodec = () => {
            const codec = getDatatypeByCode(dataType)?.codec
            return codec ? resolve(codec) : undefined
        }

        let currentValueDecoded: DescriptorValue = currentValueRaw
        let currentValueUnrecognized: true | undefined
        if (propertyCodec) {
            const decoded = tryDecode(propertyCodec, currentValueBytes)
            if (decoded === undefined) currentValueUnrecognized = true
            currentValueDecoded = decoded ?? currentValueRaw
        }

        let minimumValue: DescriptorValue | undefined
        let maximumValue: DescriptorValue | undefined
        let stepSize: DescriptorValue | undefined
        let numberOfValues: number | undefined
        let supportedValuesRaw: DescriptorValue[] | undefined
        let supportedValuesDecoded: DescriptorValue[] | undefined
        const unrecognizedSupportedValues: DescriptorValue[] = []

        if (formFlag === 0x01) {
            minimumValue = readValue()
            maximumValue = readValue()
            stepSize = readValue()
            const rangeCodec = propertyCodec && datatypeCodec()
            if (propertyCodec && rangeCodec) {
                const [minBytes, maxBytes, stepBytes] = [minimumValue, maximumValue, stepSize].map(value =>
                    rangeCodec.encode(value)
                )
                minimumValue = tryDecode(propertyCodec, minBytes) ?? minimumValue
                maximumValue = tryDecode(propertyCodec, maxBytes) ?? maximumValue
                stepSize = tryDecode(propertyCodec, stepBytes) ?? stepSize
            }
        } else if (formFlag === 0x02) {
            numberOfValues = reader.read(uint16)
            supportedValuesRaw = []
            for (let i = 0; i < numberOfValues; i++) supportedValuesRaw.push(readValue())
            supportedValuesDecoded = supportedValuesRaw
            const enumerationCodec = propertyCodec && supportedValuesRaw.length > 0 && datatypeCodec()
            if (propertyCodec && enumerationCodec)
                supportedValuesDecoded = supportedValuesRaw.map(rawValue => {
                    const decoded = tryDecode(propertyCodec, enumerationCodec.encode(rawValue))
                    if (decoded === undefined) unrecognizedSupportedValues.push(rawValue)
                    return decoded ?? rawValue
                })
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
            bytesRead: reader.bytesRead,
        }
    }
}
