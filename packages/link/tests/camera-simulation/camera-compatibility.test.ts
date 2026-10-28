import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import type {
    CapabilityStatus,
    SupportMatrix,
    SupportMatrixLine,
    SupportMatrixRow,
} from '@scripts/camera-profiles/support-matrix'
import { loadCameraProfile, type CameraProfile, type ProfileFidelity } from '@transport/simulated/camera-profile'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CAPABILITIES, evaluateCapabilities, simulateCamera } from './camera-capabilities'

const packageDirectory = path.resolve(__dirname, '../..')
const profileDirectory = path.join(packageDirectory, 'camera-profiles')
const matrixPath =
    process.env.CAMERA_SUPPORT_MATRIX ?? path.join(packageDirectory, 'test-results/camera-support-matrix.json')
const catalog = loadCatalog()

function profileFiles(directory: string): string[] {
    return readdirSync(directory)
        .sort()
        .flatMap(entry => {
            const full = path.join(directory, entry)
            if (statSync(full).isDirectory()) return profileFiles(full)
            return entry.endsWith('.json') ? [full] : []
        })
}

const profiles: { file: string; relativePath: string; profile: CameraProfile }[] = profileFiles(profileDirectory).map(
    file => {
        const relativePath = path.relative(profileDirectory, file)
        return { file, relativePath, profile: loadCameraProfile(readFileSync(file, 'utf8'), relativePath) }
    }
)
const rows: SupportMatrixRow[] = []

describe('camera profiles', () => {
    it('are organized as <manufacturer>/<line>/<id>.json with unique ids', () => {
        expect(profiles.length).toBeGreaterThan(0)
        const identifiers = new Set<string>()
        for (const { file, relativePath, profile } of profiles) {
            expect(path.basename(file, '.json')).toBe(profile.id)
            expect(relativePath.split(path.sep)).toHaveLength(3)
            expect(identifiers.has(profile.id)).toBe(false)
            identifiers.add(profile.id)
        }
    })

    it('reference lines that exist in the camera catalog', () => {
        for (const { profile } of profiles) {
            if (!profile.catalog) continue
            const manufacturer = catalog.manufacturers.find(
                candidate => candidate.name === profile.catalog!.manufacturer
            )
            expect(
                manufacturer?.lines.some(line => line.name === profile.catalog!.line),
                profile.id
            ).toBe(true)
        }
    })
})

describe.each(profiles.map(entry => [entry.relativePath, entry.profile] as const))(
    'simulated %s',
    (relativePath, profile) => {
        it('records every capability as pass, fail, unsupported or no-data', async () => {
            const simulated = simulateCamera(profile)
            const results = await evaluateCapabilities(simulated)
            await simulated.camera.disconnect().catch(() => undefined)

            rows.push({
                profile: profile.id,
                path: relativePath,
                manufacturer: profile.manufacturer,
                line: profile.line,
                model: profile.model,
                fidelity: profile.provenance.fidelity,
                ...(profile.firmware && { firmware: profile.firmware }),
                ...(profile.catalog && { catalogLine: profile.catalog.line }),
                quirks: {
                    total: profile.quirks.length,
                    simulated: profile.quirks.filter(quirk => quirk.behaviour.kind !== 'none').length,
                    unverified: profile.quirks.filter(quirk => quirk.unverified).length,
                },
                results,
            })
            expect(Object.keys(results)).toHaveLength(CAPABILITIES.length)
            // A failure against captured hardware data is a darkgrade regression; documented rows only report.
            if (profile.provenance.fidelity === 'captured') {
                const failures = Object.entries(results).filter(([, result]) => result.status === 'fail')
                expect(failures).toEqual([])
            }
        })
    }
)

function catalogCoverage(): SupportMatrixLine[] {
    return catalog.manufacturers.flatMap(manufacturer =>
        manufacturer.lines.map(line => {
            const covering = profiles
                .map(entry => entry.profile)
                .filter(
                    profile => profile.catalog?.manufacturer === manufacturer.name && profile.catalog.line === line.name
                )
            const documented = covering.find(profile => profile.provenance.fidelity === 'documented')
            const unverified = line.quirks.filter(quirk => quirk.unverified).map(quirk => quirk.id)
            const notes = [
                documented
                    ? undefined
                    : 'No documented mock: the catalog has no PTP-capable model with a USB product ID.',
                line.note,
                unverified.length ? `Unverified quirks: ${unverified.join(', ')}.` : undefined,
            ].filter(Boolean)
            return {
                manufacturer: manufacturer.name,
                line: line.name,
                protocolFamily: line.protocolFamily,
                modelCount: line.models.length,
                capturedProfiles: covering
                    .filter(profile => profile.provenance.fidelity === 'captured')
                    .map(profile => profile.id),
                ...(documented && { documentedProfile: documented.id }),
                ...(notes.length && { note: notes.join(' ') }),
            }
        })
    )
}

afterAll(() => {
    const emptyTotals = (): Record<CapabilityStatus, number> => ({ pass: 0, fail: 0, unsupported: 0, 'no-data': 0 })
    const totals: Record<ProfileFidelity, Record<CapabilityStatus, number>> = {
        captured: emptyTotals(),
        documented: emptyTotals(),
    }
    for (const row of rows) for (const result of Object.values(row.results)) totals[row.fidelity][result.status] += 1
    const matrix: SupportMatrix = {
        generatedAt: new Date().toISOString(),
        ...(process.env.GITHUB_SHA && { revision: process.env.GITHUB_SHA.slice(0, 12) }),
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows,
        lines: catalogCoverage(),
        totals,
    }
    mkdirSync(path.dirname(matrixPath), { recursive: true })
    writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
})
