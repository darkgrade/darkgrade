import { SDIDevicePropInfoArrayCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { createSonyRegistry } from '@ptp/registry'
import { describe, expect, test } from 'vitest'

const littleEndianRegistry = createSonyRegistry(true)

function join(...chunks: Uint8Array[]): Uint8Array {
    const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0))
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }
    return result
}

describe('Sony extended property inventory', () => {
    test('decodes the count header, range forms, and a single enum list without consuming the next property', () => {
        const codecs = littleEndianRegistry.codecs
        const rangeProperty = join(
            codecs.uint16.encode(0x5001),
            codecs.uint16.encode(0x0004),
            codecs.uint8.encode(0x01),
            codecs.uint8.encode(0x01),
            codecs.uint16.encode(1),
            codecs.uint16.encode(2),
            codecs.uint8.encode(0x01),
            codecs.uint16.encode(1),
            codecs.uint16.encode(5),
            codecs.uint16.encode(1)
        )
        const enumProperty = join(
            codecs.uint16.encode(0xd201),
            codecs.uint16.encode(0x0002),
            codecs.uint8.encode(0x81),
            codecs.uint8.encode(0x01),
            codecs.uint8.encode(0),
            codecs.uint8.encode(1),
            codecs.uint8.encode(0x02),
            codecs.uint16.encode(2),
            codecs.uint8.encode(1),
            codecs.uint8.encode(2)
        )
        const payload = join(codecs.uint32.encode(2), codecs.uint32.encode(0), rangeProperty, enumProperty)

        const decoded = new SDIDevicePropInfoArrayCodec(littleEndianRegistry).decode(payload)

        expect(decoded.bytesRead).toBe(payload.length)
        expect(decoded.value.numOfElements).toBe(2)
        expect(decoded.value.properties[0]).toMatchObject({
            devicePropertyCode: 0x5001,
            formFlag: 1,
            minimumValue: 1,
            maximumValue: 5,
            stepSize: 1,
        })
        expect(decoded.value.properties[1]).toMatchObject({
            devicePropertyCode: 0xd201,
            getSet: 'GET_SET',
            sonyDescriptorKind: 'control',
            sonyGetSetFlag: 0x81,
            sonyEnabledFlag: 0x01,
            formFlag: 2,
            supportedValuesRaw: [1, 2],
        })
    })

    test('uses Sony secondary enum choices when the descriptor publishes them', () => {
        const codecs = littleEndianRegistry.codecs
        const payload = join(
            codecs.uint32.encode(1),
            codecs.uint32.encode(0),
            codecs.uint16.encode(0xd201),
            codecs.uint16.encode(0x0002),
            codecs.uint8.encode(0x01),
            codecs.uint8.encode(0x01),
            codecs.uint8.encode(0),
            codecs.uint8.encode(1),
            codecs.uint8.encode(0x02),
            codecs.uint16.encode(2),
            codecs.uint8.encode(1),
            codecs.uint8.encode(2),
            codecs.uint16.encode(1),
            codecs.uint8.encode(2)
        )

        const decoded = new SDIDevicePropInfoArrayCodec(littleEndianRegistry).decode(payload)

        expect(decoded.bytesRead).toBe(payload.length)
        expect(decoded.value.properties[0]?.vendorExtensions.enumValuesSet?.raw).toEqual([1, 2])
        expect(decoded.value.properties[0]?.vendorExtensions.enumValuesGetSet?.raw).toEqual([2])
        expect(decoded.value.properties[0]?.supportedValuesRaw).toEqual([2])
    })

    test('keeps protocol-v3 display-only properties out of the writable control surface', () => {
        const codecs = littleEndianRegistry.codecs
        const descriptor = (code: number, enabledFlag: number) => join(
            codecs.uint16.encode(code),
            codecs.uint16.encode(0x0002),
            codecs.uint8.encode(0x01),
            codecs.uint8.encode(enabledFlag),
            codecs.uint8.encode(1),
            codecs.uint8.encode(1),
            codecs.uint8.encode(0x00)
        )
        const payload = join(
            codecs.uint32.encode(2),
            codecs.uint32.encode(0),
            descriptor(0xd201, 1),
            descriptor(0xd202, 2)
        )

        const decoded = new SDIDevicePropInfoArrayCodec(littleEndianRegistry).decode(payload)

        expect(decoded.value.properties[0]?.vendorExtensions.enabled).toBe(true)
        expect(decoded.value.properties[1]?.vendorExtensions.enabled).toBe(false)
        expect(decoded.value.properties[1]).toMatchObject({ sonyEnabledFlag: 2, getSet: 'GET_SET' })
    })
})
