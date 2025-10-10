import { CodecDefinition, CodecInstance, CustomCodec, type PTPRegistry } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'

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
    // Range form fields (when formFlag === 0x01)
    minimumValue?: number | bigint | string
    maximumValue?: number | bigint | string
    stepSize?: number | bigint | string
    // Enumeration form fields (when formFlag === 0x02)
    numberOfValues?: number
    supportedValuesRaw?: (number | bigint | string)[]
    supportedValuesDecoded?: (number | bigint | string)[]
    vendorExtensions?: {
        [key: string]: number | bigint | string | boolean | object
    }
}

export class DevicePropDescCodec extends CustomCodec<DevicePropDesc> {
    private use4ByteCode: boolean

    constructor(registry: PTPRegistry, use4ByteCode: boolean = false) {
        super(registry)
        this.use4ByteCode = use4ByteCode
    }

    encode(value: DevicePropDesc): Uint8Array {
        throw new Error('Encoding DevicePropDesc is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: DevicePropDesc; bytesRead: number } {
        let currentOffset = offset

        if (buffer.length < 6) {
            throw new Error(`Buffer too short: expected at least 6 bytes, got ${buffer.length}`)
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
        currentOffset += formFlagResult.bytesRead

        // Look up property name from definitions
        const propertyDef = Object.values(this.registry.properties).find((p: any) => p.code === devicePropertyCode)
        const devicePropertyName = propertyDef?.name || `Unknown_0x${devicePropertyCode.toString(16).padStart(4, '0')}`
        const devicePropertyDescription = propertyDef?.description || ''

        // Decode current value using property's codec if available
        let currentValueDecoded: number | bigint | string = currentValueRaw
        if (propertyDef && propertyDef.codec) {
            // Get codec instance from builder
            const codecInstance = typeof propertyDef.codec === 'function'
                ? propertyDef.codec(this.registry)
                : propertyDef.codec
            const decodedResult = codecInstance.decode(currentValueBytes, 0)
            currentValueDecoded = decodedResult.value
        }

        let minimumValue: number | bigint | string | undefined = undefined
        let maximumValue: number | bigint | string | undefined = undefined
        let stepSize: number | bigint | string | undefined = undefined
        let numberOfValues: number | undefined = undefined
        let supportedValuesRaw: (number | bigint | string)[] | undefined = undefined
        let supportedValuesDecoded: (number | bigint | string)[] | undefined = undefined

        // Handle form field based on FormFlag
        if (formFlag === 0x01) {
            // Range form
            const minResult = valueCodec.decode(buffer, currentOffset)
            minimumValue = minResult.value.value
            currentOffset += minResult.bytesRead

            const maxResult = valueCodec.decode(buffer, currentOffset)
            maximumValue = maxResult.value.value
            currentOffset += maxResult.bytesRead

            const stepResult = valueCodec.decode(buffer, currentOffset)
            stepSize = stepResult.value.value
            currentOffset += stepResult.bytesRead

            // Decode range values if codec available
            if (propertyDef && propertyDef.codec && minimumValue !== undefined && maximumValue !== undefined && stepSize !== undefined) {
                // Get codec instance from builder
                const codecInstance = typeof propertyDef.codec === 'function'
                    ? propertyDef.codec(this.registry)
                    : propertyDef.codec

                const datatypeDefinition = getDatatypeByCode(dataType)
                if (datatypeDefinition?.codec) {
                    // Get datatype codec instance
                    const datatypeCodec = typeof datatypeDefinition.codec === 'function'
                        ? datatypeDefinition.codec(this.registry)
                        : datatypeDefinition.codec

                    const minBytes = datatypeCodec.encode(minimumValue)
                    const maxBytes = datatypeCodec.encode(maximumValue)
                    const stepBytes = datatypeCodec.encode(stepSize)

                    minimumValue = codecInstance.decode(minBytes, 0).value
                    maximumValue = codecInstance.decode(maxBytes, 0).value
                    stepSize = codecInstance.decode(stepBytes, 0).value
                }
            }
        } else if (formFlag === 0x02) {
            // Enumeration form
            const numValuesResult = u16.decode(buffer, currentOffset)
            numberOfValues = numValuesResult.value
            currentOffset += numValuesResult.bytesRead

            supportedValuesRaw = []
            for (let i = 0; i < numberOfValues; i++) {
                const enumValueResult = valueCodec.decode(buffer, currentOffset)
                supportedValuesRaw.push(enumValueResult.value.value)
                currentOffset += enumValueResult.bytesRead
            }

            // Decode enum values using property's codec if available
            supportedValuesDecoded = supportedValuesRaw
            if (propertyDef && propertyDef.codec && supportedValuesRaw && supportedValuesRaw.length > 0) {
                // Get codec instance from builder
                const codecInstance = typeof propertyDef.codec === 'function'
                    ? propertyDef.codec(this.registry)
                    : propertyDef.codec

                const datatypeDefinition = getDatatypeByCode(dataType)
                if (datatypeDefinition?.codec) {
                    // Get datatype codec instance
                    const datatypeCodec = typeof datatypeDefinition.codec === 'function'
                        ? datatypeDefinition.codec(this.registry)
                        : datatypeDefinition.codec

                    supportedValuesDecoded = supportedValuesRaw.map((rawVal) => {
                        const bytes = datatypeCodec.encode(rawVal)
                        const decoded = codecInstance.decode(bytes, 0)
                        return decoded.value
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
            },
            bytesRead: currentOffset - offset,
        }
    }
}

// Standard codec for 2-byte property codes (ISO standard)

// Extended codec for 4-byte property codes (Nikon extended)
