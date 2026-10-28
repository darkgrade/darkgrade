import { Camera } from '@camera/index'
import { ResponseRecordingTransport } from '@scripts/camera-lab/response-recording-transport'
import { evaluateCapabilities, type SimulatedCamera } from '@scripts/camera-profiles/camera-capabilities'
import {
    mergeCompatibility,
    renderReadmeCompatibility,
    replaceReadmeSection,
} from '@scripts/camera-profiles/compatibility-matrix'
import type { SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { loadCameraProfile, parseCode } from '@transport/simulated/camera-profile'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const profileDirectory = path.resolve(__dirname, '../../camera-profiles')

describe('hardware tier capability run', () => {
    it('classifies refusals from recorded response codes and never replays captured traffic', async () => {
        const relativePath = 'om-system-olympus/pen-compacts-tg/olympus-e-pl5.json'
        const profile = loadCameraProfile(readFileSync(path.join(profileDirectory, relativePath), 'utf8'), relativePath)
        // A SimulatedTransport stands in for the USB transport the lab job wraps.
        const transport = new ResponseRecordingTransport(new SimulatedTransport(profile))
        const target: SimulatedCamera = {
            profile,
            camera: new Camera({
                transport,
                vendorId: parseCode(profile.usb!.vendorId),
                logger: { renderInTerminal: false, captureConsole: false, expanded: false },
            }),
            transport,
            tier: 'hardware',
            timeoutMilliseconds: 5_000,
        }
        const results = await evaluateCapabilities(target)
        await target.camera.disconnect().catch(() => undefined)

        expect(results.session?.status).toBe('pass')
        expect(results.capture).toMatchObject({ status: 'unsupported', detail: expect.stringContaining('0x2005') })
        expect(results['recorded-exchanges']).toEqual({
            status: 'no-data',
            detail: 'captured traffic is not replayed on hardware',
        })
        expect(results.events?.status).toBe('no-data')
        expect(transport.responseCodes).toContain(0x2005)
    })
})

function row(overrides: Partial<SupportMatrixRow>): SupportMatrixRow {
    return {
        profile: 'profile',
        path: 'path',
        manufacturer: 'Canon',
        line: 'EOS R',
        model: 'EOS R6 Mark III',
        fidelity: 'documented',
        quirks: { total: 0, simulated: 0, unverified: 0 },
        results: { session: { status: 'no-data', detail: '' } },
        ...overrides,
    }
}

function matrix(rows: SupportMatrixRow[]): SupportMatrix {
    return {
        generatedAt: '2026-10-28T00:00:00.000Z',
        capabilities: [{ id: 'session', label: 'Connect / session' }],
        rows,
        lines: [],
        totals: {},
    }
}

describe('merged compatibility matrix', () => {
    const passing = { session: { status: 'pass' as const, detail: 'ok' } }
    const simulation = matrix([
        row({ profile: 'canon-eos-r-documented', scope: 'line', usb: ['04a9:3323'] }),
        row({ profile: 'canon-canon-eos-r6-mark-iii', scope: 'model', usb: ['04a9:3323'] }),
        row({ profile: 'canon-eos-r6-mark-iii', fidelity: 'captured', usb: ['04a9:3323'] }),
        row({ profile: 'canon-canon-eos-550d', model: 'Canon EOS 550D', scope: 'model', usb: ['04a9:31ea'] }),
        row({ profile: 'canon-canon-rebel-t2i', model: 'Canon Rebel T2i', scope: 'model', usb: ['04a9:31ea'] }),
    ])

    it('takes each camera from its strongest evidence: hardware, then captured, then documented', () => {
        const hardware = matrix([
            row({
                profile: 'canon-eos-r6-mark-iii',
                fidelity: 'hardware',
                host: 'darkgrade02',
                usb: ['04a9:3323'],
                results: passing,
            }),
        ])
        const merged = mergeCompatibility(simulation, hardware)
        const r6 = merged.cameras.find(camera => camera.usb.includes('04a9:3323'))!
        expect(r6).toMatchObject({ fidelity: 'hardware', host: 'darkgrade02', results: passing })
        expect(r6.alsoCoveredBy.map(entry => entry.fidelity).sort()).toEqual(['captured', 'documented'])

        const withoutHardware = mergeCompatibility(simulation)
        expect(withoutHardware.cameras.find(camera => camera.usb.includes('04a9:3323'))?.fidelity).toBe('captured')
    })

    it('treats models sharing a USB identity as one camera and drops line mocks when model mocks exist', () => {
        const merged = mergeCompatibility(simulation)
        expect(merged.cameras).toHaveLength(2)
        const shared = merged.cameras.find(camera => camera.usb.includes('04a9:31ea'))!
        expect([shared.model, ...shared.aliases].sort()).toEqual(['Canon EOS 550D', 'Canon Rebel T2i'])
        expect(merged.cameras.flatMap(camera => camera.alsoCoveredBy).map(entry => entry.profile)).not.toContain(
            'canon-eos-r-documented'
        )
    })

    it('rewrites only the README text between the markers', () => {
        const section = renderReadmeCompatibility(mergeCompatibility(simulation))
        const readme = 'intro\n<!-- camera-compatibility:start -->\nold\n<!-- camera-compatibility:end -->\noutro\n'
        const updated = replaceReadmeSection(readme, section)
        expect(updated.startsWith('intro\n<!-- camera-compatibility:start -->')).toBe(true)
        expect(updated.endsWith('<!-- camera-compatibility:end -->\noutro\n')).toBe(true)
        expect(updated).not.toContain('\nold\n')
        expect(() => replaceReadmeSection('no markers', section)).toThrow(/markers/)
    })
})
