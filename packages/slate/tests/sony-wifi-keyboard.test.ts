import { sonyWifiKeyboardCharacter, typeSonyWifiKeyboard } from '@vendors/sony/wifi-keyboard'
import { describe, expect, it } from 'vitest'

describe('Sony Wi-Fi keyboard', () => {
    it('plans every printable ASCII character', () => {
        for (let code = 32; code <= 126; code++)
            expect(sonyWifiKeyboardCharacter(String.fromCharCode(code)).presses).toBeGreaterThan(0)
        expect(sonyWifiKeyboardCharacter('A')).toMatchObject({ bank: 0, key: 4, presses: 1, uppercase: true })
        expect(sonyWifiKeyboardCharacter('0')).toMatchObject({ bank: 1, key: 18, presses: 1 })
        expect(sonyWifiKeyboardCharacter('!')).toMatchObject({ bank: 2, key: 4, presses: 1 })
    })
    it('rejects unsupported or multi-character input without echoing it', () => {
        expect(() => sonyWifiKeyboardCharacter('é')).toThrow('unsupported')
        expect(() => sonyWifiKeyboardCharacter('')).toThrow('Expected one')
        expect(() => sonyWifiKeyboardCharacter('ab')).toThrow('Expected one')
    })
    it('refuses an unrecognized screen before pressing any buttons', async () => {
        let presses = 0
        await expect(
            typeSonyWifiKeyboard('demo', {
                image: () => ({ width: 640, height: 480, rgba: new Uint8Array(640 * 480 * 4) }),
                press: async () => {
                    presses++
                },
                text: async () => '',
            })
        ).rejects.toThrow('validated Sony keyboard')
        expect(presses).toBe(0)
    })
})
