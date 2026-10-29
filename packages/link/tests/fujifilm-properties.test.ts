import { Camera } from '@camera/index'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { createFujifilmRegistry, createPTPRegistry } from '@ptp/registry'
import { TransportType } from '@transport/interfaces/transport-types'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

const registry = createFujifilmRegistry(true)

describe('Fujifilm properties from the X-T50 contributor captures', () => {
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
        const sent: Uint8Array[] = []
        let response = new Uint8Array()
        let transactionId = 0
        let responseCode = 0x2001
        const transport: TransportInterface = {
            connect: async () => undefined,
            disconnect: async () => undefined,
            isConnected: () => true,
            classRequestReset: async () => undefined,
            getType: () => TransportType.USB,
            isLittleEndian: () => true,
            send: async bytes => {
                sent.push(bytes.slice())
                const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
                if (view.getUint16(4, true) === 1) {
                    transactionId = view.getUint32(8, true)
                    // The capture rejected a preset Kelvin write of zero with InvalidDevicePropValue.
                    responseCode = view.getUint32(12, true) === 0xd19c ? 0x201c : 0x2001
                } else {
                    response = new Uint8Array(12)
                    const reply = new DataView(response.buffer)
                    reply.setUint32(0, 12, true)
                    reply.setUint16(4, 3, true)
                    reply.setUint16(6, responseCode, true)
                    reply.setUint32(8, transactionId, true)
                }
            },
            receive: async () => response,
        }
        const camera = new Camera({
            vendorId: VendorIDs.FUJIFILM,
            transport,
            logger: { renderInTerminal: false, captureConsole: false },
        })
        await camera.set(registry.properties.FujiWhiteBalanceShiftBlue, -2)
        const command = Buffer.from(sent[0])
        expect(command.readUInt16LE(6)).toBe(0x1016)
        expect(command.readUInt32LE(12)).toBe(0xd00c)
        expect(Buffer.from(sent[1].slice(12)).toString('hex')).toBe('feff')
        await expect(camera.set(registry.properties.FujiPresetColorTemperature, 0)).rejects.toThrow('0x201c')
    })
})
