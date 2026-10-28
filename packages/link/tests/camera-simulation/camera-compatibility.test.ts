import {
    CAPABILITIES,
    evaluateCapabilities,
    simulateCamera,
    simulateCameraOverPtpIp,
    type SimulatedCamera,
} from '@scripts/camera-profiles/camera-capabilities'
import { loadCatalog } from '@scripts/camera-profiles/camera-catalog'
import { slug } from '@scripts/camera-profiles/catalog-names'
import { ProgressLog, rowKey, type PlannedRow } from '@scripts/camera-profiles/compat-progress'
import { catalogModelMocks } from '@scripts/camera-profiles/documented-profile'
import {
    countStatuses,
    type MatrixTransport,
    type SupportMatrix,
    type SupportMatrixLine,
    type SupportMatrixRow,
} from '@scripts/camera-profiles/support-matrix'
import { matchesFilters, parseFilters } from '@scripts/compat-ui/compat-filters'
import {
    loadCameraProfile,
    ptpIpPersonality,
    validateCameraProfile,
    type CameraProfile,
    type ProfileFidelity,
} from '@transport/simulated/camera-profile'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

/**
 * COMPAT_ONLY limits the run to the rows a compatibility-UI filter selects (for example
 * "manufacturer=canon&line=eos-r&transport=ptp-ip"); the full matrix is then left untouched and the
 * subset's matrix is written next to its progress log.
 */
const onlyFilter = process.env.COMPAT_ONLY?.trim() || undefined

interface PlannedProfile {
    plan: PlannedRow
    profile: CameraProfile
}

function plan(
    profile: CameraProfile,
    relativePath: string,
    transport: MatrixTransport,
    scope?: 'line' | 'model'
): PlannedProfile {
    return {
        profile,
        plan: {
            key: rowKey({ fidelity: profile.provenance.fidelity, transport, profile: profile.id }),
            profile: profile.id,
            path: relativePath,
            manufacturer: profile.manufacturer,
            line: profile.line,
            ...(profile.catalog && { catalogLine: profile.catalog.line }),
            model: profile.model,
            fidelity: profile.provenance.fidelity,
            ...(scope && { scope }),
            transport,
            ...(usbIdentities(profile) && { usb: usbIdentities(profile) }),
        },
    }
}

function selected(entry: PlannedProfile): boolean {
    if (!onlyFilter) return true
    const filters = { ...parseFilters(onlyFilter, []), status: {} }
    const { plan: row } = entry
    return matchesFilters(
        {
            ...row,
            manufacturerSlug: slug(row.manufacturer),
            lineSlug: slug(row.line),
            usb: row.usb ?? [],
            unverified: entry.profile.quirks.some(quirk => quirk.unverified),
            unverifiedQuirks: 0,
            cells: {},
            state: 'idle',
        },
        filters
    )
}

const profilePlans = profiles.map(({ relativePath, profile }) =>
    plan(profile, relativePath, 'usb', profile.provenance.fidelity === 'documented' ? 'line' : undefined)
)
const modelPlans = modelMocks.mocks.map(mock =>
    plan(mock.profile, `catalog:${mock.manufacturer.name}/${mock.line.name}/${mock.model.name}`, 'usb', 'model')
)
/** Every profile that documents a standard PTP/IP personality also runs over IPTransport. */
const ptpIpPlans = [...profilePlans, ...modelPlans]
    .filter(entry => ptpIpPersonality(entry.profile))
    .map(entry => plan(entry.profile, entry.plan.path, 'ptp-ip', entry.plan.scope))
const plannedProfiles = profilePlans.filter(selected)
const plannedModels = modelPlans.filter(selected)
const plannedPtpIp = ptpIpPlans.filter(selected)
let progress: ProgressLog

beforeAll(() => {
    progress = ProgressLog.start({
        source: 'simulation',
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows: [...plannedProfiles, ...plannedModels, ...plannedPtpIp].map(entry => entry.plan),
        ...(onlyFilter && { filter: onlyFilter }),
    })
})

function usbIdentities(profile: CameraProfile): string[] | undefined {
    if (!profile.usb) return undefined
    const vendor = profile.usb.vendorId.slice(2).padStart(4, '0')
    return profile.usb.productIds.map(product => `${vendor}:${product.slice(2).padStart(4, '0')}`)
}

async function evaluateProfile({ plan: planned, profile }: PlannedProfile) {
    let simulated: SimulatedCamera
    let stop: () => Promise<void>
    if (planned.transport === 'ptp-ip') {
        const overNetwork = await simulateCameraOverPtpIp(profile)
        simulated = overNetwork
        stop = overNetwork.stop
    } else {
        simulated = simulateCamera(profile)
        stop = () => simulated.camera.disconnect().catch(() => undefined)
    }
    const results = await evaluateCapabilities(simulated, {
        onStart: capability => progress.capabilityStarted(planned.key, capability),
        onResult: (capability, result, duration) =>
            progress.capabilityFinished(planned.key, capability, result, duration),
    })
    await stop()
    const row: SupportMatrixRow = {
        profile: profile.id,
        path: planned.path,
        manufacturer: profile.manufacturer,
        line: profile.line,
        model: profile.model,
        fidelity: profile.provenance.fidelity,
        ...(profile.firmware && { firmware: profile.firmware }),
        ...(profile.catalog && { catalogLine: profile.catalog.line }),
        ...(planned.usb && { usb: planned.usb }),
        ...(planned.scope && { scope: planned.scope }),
        ...(planned.transport === 'ptp-ip' && { transport: 'ptp-ip' as const }),
        quirks: {
            total: profile.quirks.length,
            simulated: profile.quirks.filter(quirk => quirk.behaviour.kind !== 'none').length,
            unverified: profile.quirks.filter(quirk => quirk.unverified).length,
        },
        results,
    }
    rows.push(row)
    progress.rowFinished(row)
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

describe.each(plannedProfiles.map(entry => [entry.plan.path, entry] as const))('simulated %s', (_, entry) => {
    it('records every capability as pass, fail, unsupported or no-data', async () => {
        const results = await evaluateProfile(entry)
        // A failure against captured hardware data is a darkgrade regression; documented rows only report.
        if (entry.profile.provenance.fidelity === 'captured') {
            const failures = Object.entries(results).filter(([, result]) => result.status === 'fail')
            expect(failures).toEqual([])
        }
    })
})

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

describe.each(plannedModels.map(entry => [entry.profile.id, entry] as const))('simulated model %s', (_, entry) => {
    it('records every capability as pass, fail, unsupported or no-data', async () => {
        await evaluateProfile(entry)
    })
})

describe('PTP/IP simulation', () => {
    it('covers every profile that documents a standard PTP/IP personality', () => {
        const lines = new Set(ptpIpPlans.map(entry => `${entry.profile.manufacturer}/${entry.profile.line}`))
        expect(lines).toEqual(
            new Set([
                'Sony/Alpha full-frame E-mount',
                'Sony/Alpha APS-C E-mount',
                'Sony/ZV',
                'Sony/Cinema Line FX / ILME',
                'Sony/RX compacts',
                'Pentax / Ricoh Imaging/Ricoh THETA',
            ])
        )
    })
})

describe.each(plannedPtpIp.map(entry => [entry.profile.id, entry] as const))('simulated over PTP/IP %s', (_, entry) => {
    it('gives the same capability results as over USB', async () => {
        const results = await evaluateProfile(entry)
        const overUsb = rows.find(row => row.profile === entry.profile.id && row.transport !== 'ptp-ip')
        // The transport must be transparent: any difference is an IPTransport or framing bug.
        if (overUsb) {
            const statuses = (values: SupportMatrixRow['results']) =>
                Object.fromEntries(Object.entries(values).map(([id, result]) => [id, result.status]))
            expect(statuses(results)).toEqual(statuses(overUsb.results))
        }
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

/** Catalog lines with Wi-Fi evidence that the PTP/IP tier does not simulate, and why. */
function ptpIpNotSimulated(): { manufacturer: string; line: string; reason: string }[] {
    const simulatedLines = new Set(ptpIpPlans.map(entry => entry.profile.catalog?.line))
    return catalog.manufacturers.flatMap(manufacturer =>
        manufacturer.lines.flatMap(line => {
            if (simulatedLines.has(line.name)) return []
            const name = line.name.split(' (')[0]
            if (line.quirks.some(quirk => quirk.id === 'fuji-ptpip-own-framing')) {
                const reason =
                    'Fujifilm Wi-Fi uses its own framing on TCP 55740-55742; IPTransport speaks standard PTP/IP only.'
                return [{ manufacturer: manufacturer.name, line: name, reason }]
            }
            if (manufacturer.name === 'Canon' || manufacturer.name === 'Nikon') {
                const reason =
                    "The catalog cites standard PTP/IP for Canon and Nikon only at manufacturer level (ptpip-standard-port); no source names this line's models."
                return [{ manufacturer: manufacturer.name, line: name, reason }]
            }
            return []
        })
    )
}

afterAll(() => {
    const totals: SupportMatrix['totals'] = {}
    const overUsb = rows.filter(row => row.transport !== 'ptp-ip')
    for (const fidelity of ['captured', 'documented'] satisfies ProfileFidelity[]) {
        totals[fidelity] = countStatuses(overUsb.filter(row => row.fidelity === fidelity && row.scope !== 'model'))
    }
    const networkRows = rows.filter(row => row.transport === 'ptp-ip')
    const matrix: SupportMatrix = {
        generatedAt: new Date().toISOString(),
        ...(process.env.GITHUB_SHA && { revision: process.env.GITHUB_SHA.slice(0, 12) }),
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows,
        lines: catalogCoverage(),
        totals,
        ptpIp: { simulated: networkRows.length, totals: countStatuses(networkRows), notSimulated: ptpIpNotSimulated() },
        catalogModels: {
            simulated: overUsb.filter(row => row.scope === 'model').length,
            skipped: modelMocks.skipped,
            totals: countStatuses(overUsb.filter(row => row.scope === 'model')),
        },
    }
    // A filtered run never replaces the full matrix; its subset is kept beside its progress log.
    const output =
        onlyFilter && progress.file
            ? progress.file.replace(/\.jsonl$/, '.matrix.json')
            : onlyFilter
              ? undefined
              : matrixPath
    if (output) {
        mkdirSync(path.dirname(output), { recursive: true })
        writeFileSync(output, `${JSON.stringify(matrix, null, 2)}\n`)
    }
    progress.finish('completed', output && path.relative(packageDirectory, output))
})
