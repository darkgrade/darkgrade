import { combineHardwareMatrices } from '@scripts/camera-lab/combine-lab-results'
import { capabilityRecords, type SupportMatrix, type SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { describe, expect, it } from 'vitest'

const row: SupportMatrixRow = {
    profile: 'camera',
    path: 'camera.json',
    manufacturer: 'Camera',
    line: 'Line',
    model: 'Model',
    fidelity: 'hardware',
    results: { session: { status: 'pass', detail: 'fixture' } },
    quirks: { total: 0, simulated: 0, unverified: 0 },
}
const matrix = (generatedAt: string, revision: string, rows = [row]): SupportMatrix => ({
    generatedAt,
    revision,
    rows,
    capabilities: [{ id: 'session', label: 'Session' }],
    lines: [],
    totals: {},
})

describe('hardware result source preservation', () => {
    it('retains original timestamps/revisions across repeated aggregation and exports records with those sources', () => {
        const old = matrix('2026-01-01T00:00:00Z', 'old')
        const current = matrix('2026-10-28T00:00:00Z', 'current')
        const combined = combineHardwareMatrices([old, current])
        expect(combined.revision).toBeUndefined()
        expect(combined.rows.map(row => row.source?.revision)).toEqual(['old', 'current'])
        const recombined = combineHardwareMatrices([combined])
        expect(recombined.rows.map(row => row.source?.generatedAt)).toEqual([old.generatedAt, current.generatedAt])
        expect(capabilityRecords(recombined, 'hardware').map(record => [record.generated_at, record.revision])).toEqual(
            [
                [old.generatedAt, 'old'],
                [current.generatedAt, 'current'],
            ]
        )
        expect(capabilityRecords(recombined, 'hardware', 'publishing-revision').map(record => record.revision)).toEqual(
            ['old', 'current']
        )
    })
})
