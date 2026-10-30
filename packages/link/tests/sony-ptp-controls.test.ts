import { describe, expect, it } from 'vitest'
import { performSonyPtpControl, sonyPtpControls, supportsSonyPtpSettings } from '@vendors/sony/ptp-controls'
import type { SonyPropertyState } from '@camera/sony-camera'

function property(name: string, value: string, allowedValues: string[], extra: Partial<SonyPropertyState> = {}): SonyPropertyState {
    return { name, value, allowedValues, writable: true, enabled: true, code: 0x5007, codeHex: '0x5007', description: '', rawValue: 160, sonyEnabledFlag: 1, sonyGetSetFlag: 1, ...extra }
}

describe('native Sony settings backend selection', () => {
    const properties = [property('FNumber', 'f/1.6', ['f/1.6', 'f/2']), property('Iso', 'ISO 400', ['ISO 400', 'ISO 800'])]
    it('accepts friendly ISO/aperture values and keeps native property metadata', () => {
        expect(supportsSonyPtpSettings(properties, { iso: '800', aperture: 'f/2.0' })).toBe(true)
        expect(sonyPtpControls(properties).aperture).toBe(properties[0])
    })
    it('requires every requested control before selecting PTP', () => {
        expect(supportsSonyPtpSettings(properties, { aperture: 'f/2', whiteBalance: 'Auto' })).toBe(false)
        expect(supportsSonyPtpSettings([properties[0]!, { ...properties[1]!, writable: false }], { iso: 800 })).toBe(false)
        expect(supportsSonyPtpSettings([properties[0]!, { ...properties[1]!, enabled: false }], { iso: 800 })).toBe(false)
        expect(supportsSonyPtpSettings(properties, { iso: 99999 })).toBe(false)
        expect(supportsSonyPtpSettings(properties, {})).toBe(false)
        expect(supportsSonyPtpSettings(properties, { unknown: 'x' })).toBe(false)
    })
    it('uses the newer still format when both format properties are present', () => {
        const current = property('StillFileFormat', 'JPEG', ['JPEG', 'RAW'])
        expect(sonyPtpControls([property('CompressionSetting', 'RAW', ['RAW']), current]).imageFormat).toBe(current)
    })
    it('reports Auto from the separate mode without changing retained raw ISO or availability', () => {
        const iso = property('Iso', 'ISO 1250', [], { rawValue: 1250, writable: false, enabled: false })
        const mode = property('GainControlSetting', 'Auto', ['Auto', 'Manual'], { rawValue: 1 })
        expect(sonyPtpControls([iso, mode]).iso).toMatchObject({ value: 'ISO AUTO', rawValue: 1250, writable: false })
        expect(iso.value).toBe('ISO 1250')
    })
    it('writes an advertised native value and reads fresh state afterward', async () => {
        const calls: string[] = []
        let states = structuredClone(properties)
        const camera = {
            getSonyPropertyStates: async () => { calls.push('read'); return states },
            setIso: async (value: string) => { calls.push(value); states = states.map(state => state.name === 'Iso' ? { ...state, value } : state) },
        }
        const result = await performSonyPtpControl(camera as any, 'set-iso', '800')
        expect(calls).toEqual(['read', 'ISO 800', 'read'])
        expect(result.controls.iso?.value).toBe('ISO 800')
        expect(result.transport).toBe('sony-ptp-usb')
    })
    it('does not substitute SDK values or retry a failed native setter', async () => {
        let writes = 0
        const camera = {
            getSonyPropertyStates: async () => properties,
            setIso: async () => { writes++; throw new Error('Camera rejected write') },
        }
        await expect(performSonyPtpControl(camera as any, 'set-iso', 260)).rejects.toThrow('advertised')
        expect(writes).toBe(0)
        await expect(performSonyPtpControl(camera as any, 'set-iso', 800)).rejects.toThrow('Camera rejected write')
        expect(writes).toBe(1)
    })
})
