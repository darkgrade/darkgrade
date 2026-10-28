import { mergeCompatibility, renderCompatibility } from '@scripts/camera-profiles/compatibility-matrix'
import type { SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { describe, expect, it } from 'vitest'

const row = (overrides: Partial<SupportMatrixRow>): SupportMatrixRow => ({
    profile: 'example',
    path: 'example.json',
    manufacturer: 'Sony',
    line: 'APS-C',
    model: 'ILCE-6700',
    fidelity: 'captured',
    usb: ['054c:096f'],
    quirks: { total: 0, simulated: 0, unverified: 0 },
    results: { session: { status: 'no-data', detail: 'unknown' } },
    ...overrides,
})
const matrix = (rows: SupportMatrixRow[]): SupportMatrix => ({
    generatedAt: '2026-10-28T12:00:00Z',
    revision: 'abc123',
    capabilities: [{ id: 'session', label: 'Session' }],
    rows,
    lines: [],
    totals: {},
})

describe('capability evidence boundaries', () => {
    it('keeps two Sony bodies with a shared USB mode in separate product lines', () => {
        const merged = mergeCompatibility(
            matrix([row({}), row({ line: 'Full-frame', model: 'A7 III', fidelity: 'documented' })])
        )
        expect(merged.cameras).toHaveLength(2)
    })

    it('keeps distinct models sharing both USB identity and product line separate', () => {
        const merged = mergeCompatibility(
            matrix([
                row({ model: 'Sony SLT-A57', line: 'A-mount', usb: ['054c:0669'] }),
                row({ model: 'Sony SLT-A37', line: 'A-mount', usb: ['054c:0669'], fidelity: 'documented' }),
            ])
        )
        expect(merged.cameras).toHaveLength(2)
    })

    it('retains a captured result when hardware did not exercise it, with explicit provenance', () => {
        const captured = matrix([row({ results: { session: { status: 'pass', detail: 'replayed response' } } })])
        const hardware = matrix([row({ fidelity: 'hardware', host: 'darkgrade01' })])
        const merged = mergeCompatibility(captured, hardware)
        expect(merged.cameras[0].fidelity).toBe('hardware')
        expect(merged.cameras[0].results.session.status).toBe('pass')
        expect(merged.cameras[0].resultEvidence.session).toMatchObject({
            fidelity: 'captured',
            profile: 'example',
            revision: 'abc123',
        })
        expect(renderCompatibility(merged)).toContain('✅ captured')
    })

    it('preserves a physical failure over a passing simulation', () => {
        const simulated = matrix([row({ results: { session: { status: 'pass', detail: 'software' } } })])
        const hardware = matrix([
            row({ fidelity: 'hardware', results: { session: { status: 'fail', detail: 'physical failure' } } }),
        ])
        const camera = mergeCompatibility(simulated, hardware).cameras[0]
        expect(camera.results.session.status).toBe('fail')
        expect(camera.resultEvidence.session.fidelity).toBe('hardware')
    })

    it('does not let an unknown firmware bridge two observed firmware versions', () => {
        const merged = mergeCompatibility(matrix([row({}), row({ firmware: '1.00' }), row({ firmware: '2.00' })]))
        expect(merged.cameras).toHaveLength(3)
        expect(merged.cameras.map(camera => camera.firmware)).toEqual(
            expect.arrayContaining([undefined, '1.00', '2.00'])
        )
    })
})
