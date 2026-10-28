import { buildCameraIdentityTable } from '@scripts/camera-profiles/build-camera-identities'
import type { CameraCatalog } from '@scripts/camera-profiles/camera-catalog'
import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { testBenchObservations } from '@scripts/camera-profiles/test-bench-observations'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const catalog: CameraCatalog = {
    about: {},
    darkgradeGaps: {},
    manufacturers: [
        {
            name: 'Vendor',
            usbVendorId: '0x1234',
            ptpVendorExtensionId: null,
            lines: [
                {
                    name: 'Line',
                    quirks: [],
                    protocolFamily: 'PTP',
                    models: [
                        {
                            name: 'Model A',
                            usbVendorId: '0x1234',
                            usbProductId: '0x0001',
                            ptpSupported: true,
                            tetherSupportedBy: [],
                            source: 'catalog source',
                        },
                    ],
                },
            ],
        },
    ],
}
const profile = (model: string): CameraProfile => ({
    schemaVersion: 1,
    id: 'model-b',
    manufacturer: 'Vendor',
    line: 'Line',
    model,
    usb: { vendorId: '0x1234', productIds: ['0x0001'], productString: 'Digital Camera' },
    catalog: { manufacturer: 'Vendor', line: 'Line' },
    provenance: { fidelity: 'captured', sources: [{ location: 'capture' }] },
    properties: [],
    events: [],
    exchanges: [],
    quirks: [],
})

describe('identity generation evidence association', () => {
    it('preserves all explicit catalog model associations when profiles are regenerated from observations', () => {
        const catalog = loadCatalog()
        for (const observation of testBenchObservations) {
            const line = catalog.manufacturers
                .find(manufacturer => manufacturer.name === observation.manufacturer)!
                .lines.find(line => line.name === observation.line)!
            expect(
                line.models.some(model => model.name === observation.catalogModel),
                observation.id
            ).toBe(true)
        }
        const table = JSON.parse(
            readFileSync(path.resolve(__dirname, '../../src/camera/identification/camera-identities.json'), 'utf8')
        )
        for (const observation of testBenchObservations) {
            const key = `${observation.vendorId.slice(2)}:${observation.productIds[0].slice(2)}`
            expect(
                table[key].some(
                    (candidate: { models: string[]; profiles: { profileId: string }[] }) =>
                        candidate.models.includes(observation.catalogModel) &&
                        candidate.profiles.some(profile => profile.profileId === observation.id)
                ),
                observation.id
            ).toBe(true)
        }
    })
    it('never attaches a conflicting model to the sole same-line USB candidate', () => {
        const table = buildCameraIdentityTable(catalog, [profile('Model B')])
        expect(table['1234:0001']).toHaveLength(2)
        expect(table['1234:0001'][0].profiles).toEqual([])
        expect(table['1234:0001'][1].profiles[0].profileId).toBe('model-b')
    })

    it('attaches exact aliases and explicit catalog associations without turning generic USB strings into PTP aliases', () => {
        const explicit = profile('PTP Model A')
        explicit.catalog!.model = 'Model A'
        const candidate = buildCameraIdentityTable(catalog, [explicit])['1234:0001'][0]
        expect(candidate.models).toEqual(['Model A', 'PTP Model A'])
        expect(candidate.models).not.toContain('Digital Camera')
        expect(candidate.profiles).toHaveLength(1)
        expect(buildCameraIdentityTable(catalog, [profile('Model A')])['1234:0001']).toHaveLength(1)
    })

    it('rejects stale explicit model references instead of silently attaching evidence elsewhere', () => {
        const stale = profile('PTP Model A')
        stale.catalog!.model = 'Removed model'
        expect(() => buildCameraIdentityTable(catalog, [stale])).toThrow(/unknown catalog model/)
    })
})
