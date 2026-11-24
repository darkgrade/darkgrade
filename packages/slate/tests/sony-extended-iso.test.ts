import { describe, expect, it } from 'vitest'
import { createSonyRegistry } from '@ptp/registry'
import { performSonySdkControl, sonySdkControls } from '@vendors/sony/sdk-controls'
import type { SonyWifiCamera, SonySdkProperty } from '@vendors/sony/sdk-camera'

describe('Sony extended ISO on shared SDK and PTP controls', () => {
    it('round trips extension and NR bits without treating them as sensitivity', () => {
        const registry = createSonyRegistry(true)
        const codec = registry.properties.Iso.codec(registry)
        for (const [raw, label] of [[0x10000032, 'ISO 50 (extended)'], [0x1000fa00, 'ISO 64000 (extended)'], [0x01000190, 'Multi Frame NR ISO 400'], [0x12000190, 'Multi Frame NR High ISO 400 (extended)']] as const) {
            const bytes = new Uint8Array(4)
            new DataView(bytes.buffer).setUint32(0, raw, true)
            expect(codec.decode(bytes).value).toBe(label)
            expect(codec.encode(label)).toEqual(bytes)
        }
    })
    it('uses the advertised packed SDK value for an extended ISO label', async () => {
        let value = '800'
        const properties = () => [{ code: 260, value, writable: true, valueForm: 'enum', allowedValues: ['800', '268435506'] }] as SonySdkProperty[]
        const camera = {
            getSonyPropertyStates: async () => properties(),
            setSonySetting: async (_: number, requested: bigint) => { value = String(requested); return {} },
        } as unknown as SonyWifiCamera
        expect(sonySdkControls(properties()).iso?.allowedValues).toEqual(['800', '50 (extended)'])
        await performSonySdkControl(camera, 'set-iso', '50 (extended)')
        expect(value).toBe('268435506')
        expect(sonySdkControls(properties()).iso?.value).toBe('50 (extended)')
    })
})
