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
    it('does not drop unrelated line evidence when a filtered run contains only one model mock', () => {
        const merged = mergeCompatibility(
            matrix([
                row({ profile: 'one-model', scope: 'model' }),
                row({ profile: 'other-line', scope: 'line', line: 'Other line' }),
                row({ profile: 'other-model', scope: 'line', model: 'Different body' }),
            ])
        )
        expect(merged.cameras).toHaveLength(3)
    })
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

    it('does not attach another model or firmware network result using a shared USB ID', () => {
        const usb = row({ firmware: '2.00' })
        const otherModel = row({ transport: 'ptp-ip', model: 'Sony Alpha-A7III (Control)' })
        const olderFirmware = row({ transport: 'ptp-ip', firmware: '1.00' })
        const merged = mergeCompatibility(matrix([usb, otherModel, olderFirmware]))
        expect(merged.cameras).toHaveLength(3)
        expect(merged.cameras.find(camera => !camera.primaryTransport)?.ptpIp).toBeUndefined()
        expect(merged.cameras.filter(camera => camera.primaryTransport === 'ptp-ip')).toHaveLength(2)
        const matching = row({ transport: 'ptp-ip', firmware: '2.00', host: 'network-source' })
        const network = mergeCompatibility(matrix([usb, matching])).cameras[0].ptpIp
        expect(network).toMatchObject({ firmware: '2.00', host: 'network-source', generatedAt: '2026-10-28T12:00:00Z' })
        expect(network?.resultEvidence.session).toMatchObject({
            firmware: '2.00',
            host: 'network-source',
            fidelity: 'captured',
        })
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

    it('does not borrow unknown-firmware results for a known firmware, even when only one version is present', () => {
        const merged = mergeCompatibility(matrix([row({ firmware: '2.00' }), row({ transport: 'ptp-ip' })]))
        expect(merged.cameras).toHaveLength(2)
        expect(merged.cameras.find(camera => camera.firmware === '2.00')?.ptpIp).toBeUndefined()
    })

    it('retains PTP/IP-only cameras with explicit transport instead of dropping or relabeling their checks', () => {
        const merged = mergeCompatibility(
            matrix([row({ transport: 'ptp-ip', usb: [], results: { session: { status: 'pass', detail: 'network' } } })])
        )
        expect(merged.cameras).toHaveLength(1)
        expect(merged.cameras[0]).toMatchObject({
            primaryTransport: 'ptp-ip',
            results: { session: { status: 'pass' } },
        })
        expect(renderCompatibility(merged)).toContain('ptp-ip')
    })

    it('chooses newest same-tier results using original row sources, independently of aggregate order', () => {
        const old = row({
            fidelity: 'hardware',
            source: { generatedAt: '2026-01-01T00:00:00Z', revision: 'old' },
            results: { session: { status: 'pass', detail: 'old pass' } },
        })
        const current = row({
            fidelity: 'hardware',
            source: { generatedAt: '2026-10-28T00:00:00Z', revision: 'new' },
            results: { session: { status: 'fail', detail: 'new regression' } },
        })
        for (const rows of [
            [old, current],
            [current, old],
        ]) {
            const merged = mergeCompatibility(matrix([]), matrix(rows))
            const camera = merged.cameras[0]
            expect(merged.sources).toMatchObject({
                hardwareGeneratedAt: '2026-10-28T00:00:00Z',
                hardwareOldestGeneratedAt: '2026-01-01T00:00:00Z',
            })
            expect(camera.results.session).toMatchObject({ status: 'fail', detail: 'new regression' })
            expect(camera.resultEvidence.session).toMatchObject({
                generatedAt: '2026-10-28T00:00:00Z',
                revision: 'new',
            })
        }
    })

    it('surfaces equal-time contradictory evidence rather than picking an arbitrary passing row', () => {
        const camera = mergeCompatibility(
            matrix([
                row({ profile: 'pass', results: { session: { status: 'pass', detail: 'pass' } } }),
                row({ profile: 'fail', results: { session: { status: 'fail', detail: 'fail' } } }),
            ])
        ).cameras[0]
        expect(camera.results.session.status).toBe('no-data')
        expect(camera.resultEvidence.session.conflicts?.map(entry => entry.status).sort()).toEqual(['fail', 'pass'])
    })

    it('merges network capability evidence per cell instead of letting an untested hardware cell erase simulation', () => {
        const simulation = matrix([
            row({}),
            row({ transport: 'ptp-ip', results: { session: { status: 'pass', detail: 'network software' } } }),
        ])
        const hardware = matrix([row({ fidelity: 'hardware', transport: 'ptp-ip', host: 'bench' })])
        const network = mergeCompatibility(simulation, hardware).cameras[0].ptpIp!
        expect(network.fidelity).toBe('hardware')
        expect(network.results.session.status).toBe('pass')
        expect(network.resultEvidence.session.fidelity).toBe('captured')
    })

    it('does not let a lookup alias erase a row manufacturer or product-line mismatch', () => {
        const merged = mergeCompatibility(
            matrix([
                row({ manufacturer: 'Sony', catalogLine: 'Alpha APS-C E-mount (α6xxx / α5xxx)' }),
                row({ manufacturer: 'Different brand', catalogLine: 'Alpha APS-C E-mount (α6xxx / α5xxx)' }),
                row({ manufacturer: 'Sony', catalogLine: 'Different line' }),
            ])
        )
        expect(merged.cameras).toHaveLength(3)
    })
})
