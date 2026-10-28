import type { CapabilityStatus, SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { loadCameraProfile, type CameraProfile } from '@transport/simulated/camera-profile'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CAPABILITIES, evaluateCapabilities, simulateCamera } from './camera-capabilities'

const packageDirectory = path.resolve(__dirname, '../..')
const profileDirectory = path.join(packageDirectory, 'camera-profiles')
const matrixPath =
    process.env.CAMERA_SUPPORT_MATRIX ?? path.join(packageDirectory, 'test-results/camera-support-matrix.json')

function profileFiles(directory: string): string[] {
    return readdirSync(directory)
        .sort()
        .flatMap(entry => {
            const full = path.join(directory, entry)
            if (statSync(full).isDirectory()) return profileFiles(full)
            return entry.endsWith('.json') ? [full] : []
        })
}

const files = profileFiles(profileDirectory)
const rows: SupportMatrixRow[] = []

describe('camera profiles', () => {
    it('are organized as <manufacturer>/<line>/<id>.json and validate', () => {
        expect(files.length).toBeGreaterThan(0)
        const identifiers = new Set<string>()
        for (const file of files) {
            const profile = loadCameraProfile(readFileSync(file, 'utf8'), path.relative(packageDirectory, file))
            expect(path.basename(file, '.json')).toBe(profile.id)
            expect(path.relative(profileDirectory, file).split(path.sep)).toHaveLength(3)
            expect(identifiers.has(profile.id)).toBe(false)
            identifiers.add(profile.id)
        }
    })
})

describe.each(files.map(file => [path.relative(profileDirectory, file), file]))(
    'simulated %s',
    (relativePath, file) => {
        it('records every capability as pass, fail, unsupported or no-data', async () => {
            const profile: CameraProfile = loadCameraProfile(readFileSync(file, 'utf8'), relativePath)
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

afterAll(() => {
    const totals: Record<CapabilityStatus, number> = { pass: 0, fail: 0, unsupported: 0, 'no-data': 0 }
    for (const row of rows) for (const result of Object.values(row.results)) totals[result.status] += 1
    const matrix: SupportMatrix = {
        generatedAt: new Date().toISOString(),
        ...(process.env.GITHUB_SHA && { revision: process.env.GITHUB_SHA.slice(0, 12) }),
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows,
        totals,
    }
    mkdirSync(path.dirname(matrixPath), { recursive: true })
    writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
})
