import { SDIDevicePropInfoArrayCodec } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import { createSonyRegistry } from '@vendors/registry'
import { concatenate } from '@tests/fixtures/camera-fixtures'
import { describe, expect, test } from 'vitest'

const littleEndianRegistry = createSonyRegistry(true)
const { uint8, uint16, uint32 } = littleEndianRegistry.codecs
const decode = (payload: Uint8Array) => new SDIDevicePropInfoArrayCodec(littleEndianRegistry).decode(payload)

describe('Sony extended property inventory', () => {
    test.each([4, 6])('preserves exposure program width and full mode identity for datatype %s', datatype => {
        const values = datatype === 6 ? [0x00010002, 0x00078090, 0x12348090] : [2, 0x8090, 0x809f]
        const wire = datatype === 6 ? uint32 : uint16
        const payload = concatenate([
            uint32.encode(1), uint32.encode(0),
            uint16.encode(0x500e), uint16.encode(datatype),
            uint8.encode(1), uint8.encode(1),
            wire.encode(values[0]!), wire.encode(values[1]!), uint8.encode(2),
            uint16.encode(values.length), ...values.map(value => wire.encode(value)),
        ])
        const decoded = decode(payload)
        expect(decoded.bytesRead).toBe(payload.length)
        expect(decoded.value.properties[0]).toMatchObject({
            currentValueRaw: values[1],
            currentValueDecoded: 'Movie Flexible Exposure',
            supportedValuesRaw: values,
            supportedValuesDecoded: ['Program Auto', 'Movie Flexible Exposure', `Mode 0x${values[2]!.toString(16)}`],
        })
    })

    test('decodes the count header, range forms, and a single enum list without consuming the next property', () => {
        const rangeProperty = concatenate([
            uint16.encode(0x5001), uint16.encode(0x0004), uint8.encode(0x01), uint8.encode(0x01),
            uint16.encode(1), uint16.encode(2), uint8.encode(0x01), uint16.encode(1), uint16.encode(5), uint16.encode(1),
        ])
        const enumProperty = concatenate([
            uint16.encode(0xd201), uint16.encode(0x0002), uint8.encode(0x81), uint8.encode(0x01),
            uint8.encode(0), uint8.encode(1), uint8.encode(0x02), uint16.encode(2), uint8.encode(1), uint8.encode(2),
        ])
        const payload = concatenate([uint32.encode(2), uint32.encode(0), rangeProperty, enumProperty])
        const decoded = decode(payload)
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
        const payload = concatenate([
            uint32.encode(1), uint32.encode(0),
            uint16.encode(0xd201), uint16.encode(0x0002), uint8.encode(0x01), uint8.encode(0x01),
            uint8.encode(0), uint8.encode(1), uint8.encode(0x02), uint16.encode(2), uint8.encode(1), uint8.encode(2),
            uint16.encode(1), uint8.encode(2),
        ])
        const decoded = decode(payload)
        expect(decoded.bytesRead).toBe(payload.length)
        expect(decoded.value.properties[0]?.vendorExtensions.enumValuesSet?.raw).toEqual([1, 2])
        expect(decoded.value.properties[0]?.vendorExtensions.enumValuesGetSet?.raw).toEqual([2])
        expect(decoded.value.properties[0]?.supportedValuesRaw).toEqual([2])
    })

    test('keeps protocol-v3 display-only properties out of the writable control surface', () => {
        const descriptor = (code: number, enabledFlag: number) => concatenate([
            uint16.encode(code), uint16.encode(0x0002), uint8.encode(0x01), uint8.encode(enabledFlag),
            uint8.encode(1), uint8.encode(1), uint8.encode(0x00),
        ])
        const decoded = decode(concatenate([uint32.encode(2), uint32.encode(0), descriptor(0xd201, 1), descriptor(0xd202, 2)]))
        expect(decoded.value.properties[0]?.vendorExtensions.enabled).toBe(true)
        expect(decoded.value.properties[1]?.vendorExtensions.enabled).toBe(false)
        expect(decoded.value.properties[1]).toMatchObject({ sonyEnabledFlag: 2, getSet: 'GET_SET' })
    })
})
