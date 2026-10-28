import { CAPABILITIES, evaluateCapabilities, simulateCamera } from '@scripts/camera-profiles/camera-capabilities'
import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { catalogModelMocks } from '@scripts/camera-profiles/documented-profile'
import {
    countStatuses,
    type SupportMatrix,
    type SupportMatrixLine,
    type SupportMatrixRow,
} from '@scripts/camera-profiles/support-matrix'
import {
    loadCameraProfile,
    validateCameraProfile,
    type CameraProfile,
    type ProfileFidelity,
} from '@transport/simulated/camera-profile'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

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
const modelMocks = catalogModelMocks(catalog)

function usbIdentities(profile: CameraProfile): string[] | undefined {
    if (!profile.usb) return undefined
    const vendor = profile.usb.vendorId.slice(2).padStart(4, '0')
    return profile.usb.productIds.map(product => `${vendor}:${product.slice(2).padStart(4, '0')}`)
}

async function evaluateProfile(profile: CameraProfile, relativePath: string, scope?: 'line' | 'model') {
    const simulated = simulateCamera(profile)
    const results = await evaluateCapabilities(simulated)
    await simulated.camera.disconnect().catch(() => undefined)
    const usb = usbIdentities(profile)
    rows.push({
        profile: profile.id,
        path: relativePath,
        manufacturer: profile.manufacturer,
        line: profile.line,
        model: profile.model,
        fidelity: profile.provenance.fidelity,
        ...(profile.firmware && { firmware: profile.firmware }),
        ...(profile.catalog && { catalogLine: profile.catalog.line }),
        ...(usb && { usb }),
        ...(scope && { scope }),
        quirks: {
            total: profile.quirks.length,
            simulated: profile.quirks.filter(quirk => quirk.behaviour.kind !== 'none').length,
            unverified: profile.quirks.filter(quirk => quirk.unverified).length,
        },
        results,
    })
    expect(Object.keys(results)).toHaveLength(CAPABILITIES.length)
    return results
}

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
            const scope = profile.provenance.fidelity === 'documented' ? 'line' : undefined
            const results = await evaluateProfile(profile, relativePath, scope)
            // A failure against captured hardware data is a darkgrade regression; documented rows only report.
            if (profile.provenance.fidelity === 'captured') {
                const failures = Object.entries(results).filter(([, result]) => result.status === 'fail')
                expect(failures).toEqual([])
            }
        })
    }
)

describe('documented per-model mocks from the camera catalog', () => {
    it('cover every PTP model with a USB product ID, with unique ids and valid profiles', () => {
        const models = catalog.manufacturers.flatMap(manufacturer => manufacturer.lines.flatMap(line => line.models))
        expect(modelMocks.mocks.length + modelMocks.skipped.length).toBe(models.length)
        expect(new Set(modelMocks.mocks.map(mock => mock.profile.id)).size).toBe(modelMocks.mocks.length)
        for (const { profile } of modelMocks.mocks) expect(validateCameraProfile(profile), profile.id).toEqual([])
    })

    it('keep model-scoped line quirks only on the models they name or flag', () => {
        const quirkIds = (name: string) =>
            modelMocks.mocks.find(mock => mock.model.name === name)?.profile.quirks.map(quirk => quirk.id) ?? []
        expect(quirkIds('Fuji Fujifilm X-T30')).toContain('fuji-xt30-no-tether')
        expect(quirkIds('Fuji Fujifilm X-T50')).not.toContain('fuji-xt30-no-tether')
        expect(quirkIds('Leica Q3')).toContain('leica-no-capture-complete')
        expect(quirkIds('Leica Q3')).toContain('gphoto-flag-ptp-no-capture-complete')
    })

    it('apply only the libgphoto2 flags that are not commented out', () => {
        const flags = (name: string) =>
            modelMocks.mocks
                .find(mock => mock.model.name === name)
                ?.profile.quirks.filter(quirk => quirk.id.startsWith('gphoto-flag'))
                .map(quirk => quirk.id) ?? []
        expect(flags('Nikon Coolpix P1000 (PTP mode)')).toEqual(['gphoto-flag-ptp-cap', 'gphoto-flags-commented-out'])
        expect(flags('Canon EOS M')).toEqual(['gphoto-flags-commented-out'])
    })
})

describe.each(modelMocks.mocks.map(mock => [mock.profile.id, mock] as const))('simulated model %s', (_, mock) => {
    it('records every capability as pass, fail, unsupported or no-data', async () => {
        await evaluateProfile(
            mock.profile,
            `catalog:${mock.manufacturer.name}/${mock.line.name}/${mock.model.name}`,
            'model'
        )
    })
})

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
    const totals: SupportMatrix['totals'] = {}
    for (const fidelity of ['captured', 'documented'] satisfies ProfileFidelity[]) {
        totals[fidelity] = countStatuses(rows.filter(row => row.fidelity === fidelity && row.scope !== 'model'))
    }
    const matrix: SupportMatrix = {
        generatedAt: new Date().toISOString(),
        ...(process.env.GITHUB_SHA && { revision: process.env.GITHUB_SHA.slice(0, 12) }),
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows,
        lines: catalogCoverage(),
        totals,
        catalogModels: {
            simulated: rows.filter(row => row.scope === 'model').length,
            skipped: modelMocks.skipped,
            totals: countStatuses(rows.filter(row => row.scope === 'model')),
        },
    }
    mkdirSync(path.dirname(matrixPath), { recursive: true })
    writeFileSync(matrixPath, `${JSON.stringify(matrix, null, 2)}\n`)
})
