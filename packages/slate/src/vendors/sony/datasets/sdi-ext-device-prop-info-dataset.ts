import { VariableValueCodec } from '@ptp/datasets/codecs/variable-value-codec'
import { DevicePropDesc } from '@ptp/datasets/device-prop-desc-dataset'
import { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
import { SONY_SDK_PROPERTY_NAMES } from '@vendors/sony/definitions/sony-sdk-property-names'
import { CustomCodec, type PTPRegistry } from '@ptp/types/codec'
import { DatatypeCode } from '@ptp/types/datatype'
import { SonyExposureProgramCodec } from '@vendors/sony/exposure-program'

type SonyEnumValues = { raw: (number | bigint | string)[]; decoded: (number | bigint | string)[] }

/** A standard DevicePropDesc with Sony's flags and its two value lists: display (Set) and Get/Set. */
export interface SonyDevicePropDesc extends DevicePropDesc {
    sonyDescriptorKind: 'property' | 'control'
    sonyGetSetFlag: number
    sonyEnabledFlag: number
    vendorExtensions: { enabled: boolean; enumValuesSet?: SonyEnumValues; enumValuesGetSet?: SonyEnumValues }
}

export interface SDIDevicePropInfoArray {
    numOfElements: number
    properties: SonyDevicePropDesc[]
}

/**
 * Name for a Sony property Darkgrade has no definition for: the Camera Remote SDK's name
 * for the code, unless a defined property already uses that name (lookups by name must
 * stay unambiguous), else Unknown_0x....
 */
export function sonyFallbackPropertyName(code: number, registry: PTPRegistry): { name: string; description: string } {
    const sdkName = SONY_SDK_PROPERTY_NAMES[code]
    if (sdkName !== undefined && !Object.values(registry.properties).some((property: any) => property.name === sdkName)) {
        return { name: sdkName, description: 'Named from the Camera Remote SDK property table; value not decoded by Darkgrade yet.' }
    }
    return { name: `Unknown_0x${code.toString(16).padStart(4, '0')}`, description: '' }
}

export class SDIExtDevicePropInfoCodec extends CustomCodec<SonyDevicePropDesc> {
    encode(_value: SonyDevicePropDesc): Uint8Array {
        throw new Error('Encoding SonyDevicePropDesc is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SonyDevicePropDesc; bytesRead: number } {
        if (!Number.isInteger(offset) || offset < 0 || buffer.length - offset < 6) {
            throw new Error(`Buffer too short: expected at least 6 bytes, got ${buffer.length}`)
        }
        let currentOffset = offset
        const read = <Value>(codec: { decode(buffer: Uint8Array, offset: number): { value: Value; bytesRead: number } }) => {
            const result = codec.decode(buffer, currentOffset)
            currentOffset += result.bytesRead
            return result.value
        }
        const u8 = this.registry.codecs.uint8
        const u16 = this.registry.codecs.uint16

        const devicePropertyCode = read(u16)
        const dataType: DatatypeCode = read(u16)
        const getSet = read(u8)
        const isEnabled = read(u8)
        const valueCodec = new VariableValueCodec(this.registry, dataType)
        const readValue = () => read(valueCodec).value
        const factoryDefaultValue = readValue()
        const current = read(valueCodec)
        const currentValueRaw = current.value
        const currentValueBytes = current.rawBytes
        const formFlag = read(u8)
        if (formFlag > 2) throw new Error(`Invalid Sony property form flag: ${formFlag}`)

        const enumValuesSet: (number | bigint | string)[] = []
        const enumValuesGetSet: (number | bigint | string)[] = []
        let minimumValue: number | bigint | string | undefined
        let maximumValue: number | bigint | string | undefined
        let stepSize: number | bigint | string | undefined

        if (formFlag === 0x01) {
            minimumValue = readValue()
            maximumValue = readValue()
            stepSize = readValue()
        } else if (formFlag === 0x02) {
            const numEnumSet = read(u16)
            for (let index = 0; index < numEnumSet; index++) enumValuesSet.push(readValue())
            // A second (Get/Set) list follows when its count is plausible.
            if (currentOffset + 2 <= buffer.length && u16.decode(buffer, currentOffset).value < 0x0200) {
                const possibleSecondCount = read(u16)
                for (let index = 0; index < possibleSecondCount; index++) enumValuesGetSet.push(readValue())
            }
        }

        const propertyDef = Object.values(this.registry.properties).find((p: any) => p.code === devicePropertyCode)

        const fallback = propertyDef ? undefined : sonyFallbackPropertyName(devicePropertyCode, this.registry)
        const devicePropertyName = propertyDef?.name || fallback!.name
        const devicePropertyDescription = propertyDef?.description || fallback!.description

        let currentValueDecoded: number | bigint | string = currentValueRaw
        let currentValueUnrecognized: true | undefined
        let enumValuesSetDecoded: (number | bigint | string)[] = enumValuesSet
        let enumValuesGetSetDecoded: (number | bigint | string)[] = enumValuesGetSet
        const rejectedValues = new Set<number | bigint | string>()

        if (propertyDef && propertyDef.codec && currentValueBytes.length > 0) {
            const codecInstance =
                devicePropertyCode === 0x500e && (dataType === 0x0004 || dataType === 0x0006)
                    ? new SonyExposureProgramCodec(this.registry, dataType)
                    : typeof propertyDef.codec === 'function' ? propertyDef.codec(this.registry) : propertyDef.codec

            try {
                currentValueDecoded = codecInstance.decode(currentValueBytes, 0).value
            } catch {
                currentValueUnrecognized = true
            }

            const definition = getDatatypeByCode(dataType)
            const decodeEnumValue = (rawValue: number | bigint | string) => {
                if (!definition?.codec) return rawValue
                try {
                    const wire = typeof definition.codec === 'function' ? definition.codec(this.registry) : definition.codec
                    return codecInstance.decode(wire.encode(rawValue), 0).value
                } catch {
                    rejectedValues.add(rawValue)
                    return rawValue
                }
            }
            enumValuesSetDecoded = enumValuesSet.map(decodeEnumValue)
            enumValuesGetSetDecoded = enumValuesGetSet.map(decodeEnumValue)
        }
        const supportedValuesRaw = enumValuesGetSet.length ? enumValuesGetSet : enumValuesSet
        const unrecognizedSupportedValues = supportedValuesRaw.filter(value => rejectedValues.has(value))

        return {
            value: {
                devicePropertyCode,
                devicePropertyName,
                devicePropertyDescription,
                dataType,
                getSet: (getSet & 0x01) === 0x01 ? 'GET_SET' : 'GET',
                factoryDefaultValue,
                currentValueRaw,
                currentValueBytes,
                currentValueDecoded,
                formFlag,
                minimumValue,
                maximumValue,
                stepSize,
                numberOfValues: enumValuesGetSet.length || enumValuesSet.length || undefined,
                supportedValuesRaw,
                supportedValuesDecoded: enumValuesGetSet.length ? enumValuesGetSetDecoded : enumValuesSetDecoded,
                ...(currentValueUnrecognized && { currentValueUnrecognized }),
                ...(unrecognizedSupportedValues.length > 0 && { unrecognizedSupportedValues }),
                sonyDescriptorKind: (getSet & 0x80) === 0x80 ? 'control' : 'property',
                sonyGetSetFlag: getSet,
                sonyEnabledFlag: isEnabled,
                vendorExtensions: {
                    // Sony mode 3 reports 0=grayed out, 1=enabled, and 2=display-only.
                    // A display-only property may advertise choices but silently ignore writes.
                    enabled: isEnabled === 0x01,
                    enumValuesSet: { raw: enumValuesSet, decoded: enumValuesSetDecoded },
                    enumValuesGetSet: { raw: enumValuesGetSet, decoded: enumValuesGetSetDecoded },
                },
            },
            bytesRead: currentOffset - offset,
        }
    }
}

export class SDIDevicePropInfoArrayCodec extends CustomCodec<SDIDevicePropInfoArray> {
    encode(_value: SDIDevicePropInfoArray): Uint8Array {
        throw new Error('Encoding SDIDevicePropInfoArray is not yet implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SDIDevicePropInfoArray; bytesRead: number } {
        const u32 = this.registry.codecs.uint32
        const numOfElements = u32.decode(buffer, offset).value
        u32.decode(buffer, offset + 4) // A reserved word follows the count and must be present.
        let currentOffset = offset + 8
        const properties: SonyDevicePropDesc[] = []
        const propCodec = new SDIExtDevicePropInfoCodec(this.registry)
        for (let index = 0; index < numOfElements; index++) {
            const { value, bytesRead } = propCodec.decode(buffer, currentOffset)
            properties.push(value)
            currentOffset += bytesRead
        }
        return { value: { numOfElements, properties }, bytesRead: currentOffset - offset }
    }
}
