import { Camera } from '@camera/index'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { createFujifilmRegistry, createPTPRegistry } from '@vendors/registry'
import { answeringTransport, ptpContainer } from '@tests/fixtures/ptp-wire'
import { describe, expect, it } from 'vitest'
import { protocolSession } from '@camera/protocol-session'

const registry = createFujifilmRegistry(true)

function fujifilmCamera(reply: Parameters<typeof answeringTransport>[0]) {
    const { transport, sent } = answeringTransport(reply)
    return { sent, camera: new Camera({ vendorId: VendorIDs.FUJIFILM, transport, logger: { renderInTerminal: false, captureConsole: false } }) }
}

function valueReadCamera(payload: string | undefined, responseCode = 0x2001) {
    const { camera, sent } = fujifilmCamera(command => [
        ...(payload === undefined ? [] : [ptpContainer(2, 0x1015, command.transactionId, Buffer.from(payload, 'hex'))]),
        ptpContainer(3, responseCode, command.transactionId),
    ])
    return { camera, commands: sent }
}

describe('Fujifilm properties from the X-T50 contributor captures', () => {
    it.each([
        ['FujiPresetWhiteBalanceShiftRed', 'fcff', -4],
        ['FujiPresetWhiteBalanceShiftBlue', '0400', 4],
        ['FujiPresetSharpness', 'd8ff', -40],
        ['FujiPresetWhiteBalance', '0880', 0x8008],
        ['FujiPresetHighIsoNoiseReduction', '0080', 0x8000],
        ['FujiPresetGrainEffect', '0400', 4],
    ] as const)('reads captured %s bytes through Camera without a descriptor', async (name, payload, expected) => {
        const { camera, commands } = valueReadCamera(payload)
        const property = registry.properties[name]
        expect(await protocolSession(camera).readValue(property)).toBe(expected)
        expect(commands).toHaveLength(1)
        expect([commands[0].code, commands[0].parameters]).toEqual([0x1015, [property.code]])
    })

    it('preserves a device refusal instead of returning a value or synthesizing a descriptor', async () => {
        // Synthetic refusal framing: the captured write refusal is covered separately below.
        const { camera, commands } = valueReadCamera(undefined, 0x200a)
        await expect(protocolSession(camera).readValue(registry.properties.FujiPresetWhiteBalance)).rejects.toMatchObject({
            name: PTPResponseError.name,
            code: 0x200a,
            operation: 'GetDevicePropValue',
        })
        expect(commands).toHaveLength(1)
    })

    it.each([undefined, '', '08', '088000'])('rejects absent, short or trailing value bytes (%s)', async payload => {
        const { camera } = valueReadCamera(payload)
        await expect(protocolSession(camera).readValue(registry.properties.FujiPresetWhiteBalance)).rejects.toBeInstanceOf(
            PTPDecodeError
        )
    })

    it('decodes signed preset values and preserves unsigned vendor values without guessed enums', () => {
        // filmkit#12 X-T50 Profile Read/Presets Save, firmware 1.31.
        const captures = [
            [registry.properties.FujiPresetWhiteBalanceShiftRed, 'fcff', -4],
            [registry.properties.FujiWhiteBalanceShiftBlue, 'feff', -2],
            [registry.properties.FujiPresetSharpness, 'd8ff', -40],
            [registry.properties.FujiPresetWhiteBalance, '0880', 0x8008],
            [registry.properties.FujiPresetHighIsoNoiseReduction, '0080', 0x8000],
            [registry.properties.FujiPresetGrainEffect, '0600', 6],
        ] as const
        for (const [property, hex, value] of captures) {
            const codec = property.codec(registry)
            expect(codec.decode(Buffer.from(hex, 'hex')).value).toBe(value)
            expect(Buffer.from(codec.encode(value)).toString('hex')).toBe(hex)
        }
        // These camera-setting labels in filmkit's display table conflict with libgphoto2.
        expect(registry.properties.FujiDynamicRange.code).toBe(0xd007)
        expect(registry.properties.FujiColorTemperature.code).toBe(0xd017)
        expect(registry.properties.FujiWhiteBalanceShiftBlue.code).toBe(0xd00c)
        expect(
            new Set<number>(Object.values(createPTPRegistry(true).properties).map(property => property.code)).has(
                0xd007
            )
        ).toBe(false)
    })

    it('sends the captured signed setting bytes and keeps a conditional preset refusal as a failure', async () => {
        // The capture rejected a preset Kelvin write of zero with InvalidDevicePropValue.
        let responseCode = 0x2001
        const { camera, sent } = fujifilmCamera(container => {
            if (container.type === 1) responseCode = container.parameters[0] === 0xd19c ? 0x201c : 0x2001
            else return [ptpContainer(3, responseCode, container.transactionId)]
        })
        await protocolSession(camera).set(registry.properties.FujiWhiteBalanceShiftBlue, -2)
        expect([sent[0].code, sent[0].parameters]).toEqual([0x1016, [0xd00c]])
        expect(Buffer.from(sent[1].payload).toString('hex')).toBe('feff')
        await expect(protocolSession(camera).set(registry.properties.FujiPresetColorTemperature, 0)).rejects.toThrow('0x201c')
    })
})
