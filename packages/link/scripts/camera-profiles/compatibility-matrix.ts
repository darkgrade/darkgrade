/**
 * Merges the simulation support matrix with device-lab hardware results into one camera × capability
 * table. Matching USB identities must also share a manufacturer and product line. Known firmware
 * versions stay separate. Each capability retains its own strongest available evidence source.
 */
import { identifyCamera } from '@camera/identification/camera-identification'
import {
    countStatuses,
    type CapabilityResult,
    type MatrixFidelity,
    type StatusCounts,
    type SupportMatrix,
    type SupportMatrixRow,
} from '@scripts/camera-profiles/support-matrix'

export const FIDELITY_RANK: Record<MatrixFidelity, number> = { hardware: 3, captured: 2, documented: 1 }

export interface CompatibilityCamera {
    manufacturer: string
    line: string
    catalogLine?: string
    model: string
    /** Other model names for the same USB identity (regional names, PTP/normal modes). */
    aliases: string[]
    fidelity: MatrixFidelity
    profile: string
    usb: string[]
    firmware?: string
    host?: string
    /** Weaker evidence for the same camera that the chosen row supersedes. */
    alsoCoveredBy: { fidelity: MatrixFidelity; profile: string }[]
    results: Record<string, CapabilityResult>
    /** The same camera reached over standard PTP/IP, when it was simulated there. */
    ptpIp?: { fidelity: MatrixFidelity; profile: string; results: Record<string, CapabilityResult> }
    /** Source of each selected capability; camera-level fidelity does not promote weaker results. */
    resultEvidence: Record<
        string,
        {
            fidelity: MatrixFidelity
            profile: string
            firmware?: string
            host?: string
            generatedAt: string
            revision?: string
        }
    >
}

export interface CompatibilityMatrix {
    generatedAt: string
    revision?: string
    capabilities: { id: string; label: string }[]
    sources: { simulation?: string; hardware?: string; hardwareGeneratedAt?: string }
    cameras: CompatibilityCamera[]
    totals: Partial<Record<MatrixFidelity, { cameras: number } & StatusCounts>>
}

/** Exact catalog/profile aliases may join rows; a shared USB ID alone cannot join models. */
function modelIdentity(row: SupportMatrixRow, usb: string): string {
    const [vendorId, productId] = usb.split(':').map(value => Number.parseInt(value, 16))
    const identified = identifyCamera({ vendorId, productId, ptpModel: row.model })
    const candidate = identified.status === 'matched' ? identified.candidates[0] : undefined
    if (candidate) return `${candidate.manufacturer}|${candidate.line}|${candidate.models[0]}`
    return `${row.manufacturer}|${row.catalogLine ?? row.line}|${row.model.trim().toLowerCase()}`
}

/** Groups only matching USB identities AND model aliases; unknown firmware cannot bridge versions. */
function groupByUsb(rows: SupportMatrixRow[]): SupportMatrixRow[][] {
    const parent = rows.map((_, index) => index)
    const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])))
    const owner = new Map<string, number>()
    rows.forEach((row, index) => {
        for (const usb of row.usb ?? []) {
            const identity = `${modelIdentity(row, usb)}|${usb}`
            const existing = owner.get(identity)
            if (existing === undefined) owner.set(identity, index)
            else parent[find(index)] = find(existing)
        }
    })
    const groups = new Map<number, SupportMatrixRow[]>()
    rows.forEach((row, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), row]))
    return [...groups.values()].flatMap(group => {
        const firmwares = [...new Set(group.map(row => row.firmware).filter(Boolean))]
        if (firmwares.length < 2) return [group]
        // Unknown firmware cannot bridge conflicting known firmware observations.
        return [
            group.filter(row => !row.firmware),
            ...firmwares.map(firmware => group.filter(row => row.firmware === firmware)),
        ].filter(rows => rows.length)
    })
}

function strongest(rows: SupportMatrixRow[]): SupportMatrixRow {
    return [...rows].sort((left, right) => FIDELITY_RANK[right.fidelity] - FIDELITY_RANK[left.fidelity])[0]
}

function strongestOrUndefined(rows: SupportMatrixRow[]): SupportMatrixRow | undefined {
    return rows.length ? strongest(rows) : undefined
}

export function mergeCompatibility(
    simulation: SupportMatrix,
    hardware?: SupportMatrix,
    sources: CompatibilityMatrix['sources'] = {}
): CompatibilityMatrix {
    const hasModelMocks = simulation.rows.some(row => row.scope === 'model')
    // Line mocks stand in for a whole line; with per-model mocks present they would duplicate one model.
    const simulated = simulation.rows.filter(row => !(hasModelMocks && row.scope === 'line'))
    const rows = [...(hardware?.rows.filter(row => row.fidelity === 'hardware') ?? []), ...simulated]
    const overUsb = rows.filter(row => row.transport !== 'ptp-ip')
    const overPtpIp = rows.filter(row => row.transport === 'ptp-ip')

    const cameras = groupByUsb(overUsb).map(group => {
        const chosen = strongest(group)
        const identities = new Set(group.flatMap(row => row.usb ?? []))
        const network = strongestOrUndefined(
            overPtpIp.filter(row => row.usb?.some(identity => identities.has(identity) && modelIdentity(row, identity) === modelIdentity(chosen, identity)) && (!row.firmware || !chosen.firmware || row.firmware === chosen.firmware))
        )
        const models = [...new Set(group.map(row => row.model))]
        const results: CompatibilityCamera['results'] = {}
        const resultEvidence: CompatibilityCamera['resultEvidence'] = {}
        const ordered = [...group].sort((left, right) => FIDELITY_RANK[right.fidelity] - FIDELITY_RANK[left.fidelity])
        for (const capability of simulation.capabilities) {
            const source =
                ordered.find(row => row.results[capability.id]?.status !== 'no-data' && row.results[capability.id]) ??
                ordered.find(row => row.results[capability.id])
            if (!source) continue
            results[capability.id] = source.results[capability.id]
            const matrix = source.fidelity === 'hardware' ? (hardware ?? simulation) : simulation
            resultEvidence[capability.id] = {
                fidelity: source.fidelity,
                profile: source.profile,
                generatedAt: matrix.generatedAt,
                ...(source.firmware && { firmware: source.firmware }),
                ...(source.host && { host: source.host }),
                ...(matrix.revision && { revision: matrix.revision }),
            }
        }
        return {
            manufacturer: chosen.manufacturer,
            line: chosen.line,
            ...(chosen.catalogLine && { catalogLine: chosen.catalogLine }),
            model: chosen.model,
            aliases: models.filter(model => model !== chosen.model),
            fidelity: chosen.fidelity,
            profile: chosen.profile,
            usb: [...new Set(group.flatMap(row => row.usb ?? []))].sort(),
            ...(chosen.firmware && { firmware: chosen.firmware }),
            ...(chosen.host && { host: chosen.host }),
            alsoCoveredBy: group
                .filter(row => row !== chosen)
                .map(row => ({ fidelity: row.fidelity, profile: row.profile })),
            results,
            resultEvidence,
            ...(network && {
                ptpIp: { fidelity: network.fidelity, profile: network.profile, results: network.results },
            }),
        } satisfies CompatibilityCamera
    })
    cameras.sort(
        (left, right) =>
            FIDELITY_RANK[right.fidelity] - FIDELITY_RANK[left.fidelity] ||
            left.manufacturer.localeCompare(right.manufacturer) ||
            left.line.localeCompare(right.line) ||
            left.model.localeCompare(right.model)
    )

    const totals: CompatibilityMatrix['totals'] = {}
    for (const fidelity of Object.keys(FIDELITY_RANK) as MatrixFidelity[]) {
        const matching = cameras.filter(camera => camera.fidelity === fidelity)
        if (matching.length) totals[fidelity] = { cameras: matching.length, ...countStatuses(matching) }
    }
    return {
        generatedAt: new Date().toISOString(),
        ...((hardware?.revision ?? simulation.revision) && { revision: simulation.revision ?? hardware?.revision }),
        capabilities: simulation.capabilities,
        sources: { ...sources, ...(hardware && { hardwareGeneratedAt: hardware.generatedAt }) },
        cameras,
        totals,
    }
}

const STATUS_CELL: Record<string, string> = { pass: '✅', fail: '❌', unsupported: '➖', 'no-data': '·' }

function cell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function row(cells: string[]): string {
    return `| ${cells.map(cell).join(' | ')} |`
}

function fidelityLabel(camera: CompatibilityCamera): string {
    if (camera.fidelity === 'hardware') return camera.host ? `hardware (${camera.host})` : 'hardware'
    return camera.fidelity
}

function cameraTable(matrix: CompatibilityMatrix, cameras: CompatibilityCamera[]): string[] {
    const header = [
        'Manufacturer',
        'Model',
        'USB',
        'Fidelity',
        ...matrix.capabilities.map(capability => capability.label),
    ]
    return [
        row(header),
        row(header.map(() => '---')),
        ...cameras.map(camera =>
            row([
                camera.manufacturer,
                camera.firmware ? `${camera.model} (fw ${camera.firmware})` : camera.model,
                camera.usb.join(', '),
                fidelityLabel(camera),
                ...matrix.capabilities.map(capability => {
                    const symbol = STATUS_CELL[camera.results[capability.id]?.status ?? 'no-data']
                    const evidence = camera.resultEvidence[capability.id]
                    return evidence && evidence.fidelity !== camera.fidelity ? `${symbol} ${evidence.fidelity}` : symbol
                }),
            ])
        ),
    ]
}

/** Documented cameras rolled up per catalog line: how many models pass each capability. */
function lineRollup(matrix: CompatibilityMatrix, cameras: CompatibilityCamera[]): string[] {
    const byLine = new Map<string, CompatibilityCamera[]>()
    for (const camera of cameras) {
        const key = `${camera.manufacturer} · ${camera.line}`
        byLine.set(key, [...(byLine.get(key) ?? []), camera])
    }
    const header = ['Line', 'Cameras', ...matrix.capabilities.map(capability => `${capability.label} ✅`)]
    return [
        row(header),
        row(header.map(() => '---')),
        ...[...byLine.entries()].map(([line, lineCameras]) =>
            row([
                line,
                String(lineCameras.length),
                ...matrix.capabilities.map(
                    capability =>
                        `${lineCameras.filter(camera => camera.results[capability.id]?.status === 'pass').length}`
                ),
            ])
        ),
    ]
}

const LEGEND =
    '✅ pass · ❌ fail · ➖ unsupported (camera refused it or darkgrade has no definition) · · no data. Fidelity: **hardware** = run on a physical body in the device lab; **captured** = replayed testbench evidence; **documented** = built from libgphoto2 and vendor documentation, not hardware-verified. Each capability uses its strongest available evidence; a cell labels any weaker source. A pass on captured or documented data is a software result, not physical validation. Known firmware versions remain separate; shared USB IDs do not establish model aliases.'

function summary(matrix: CompatibilityMatrix): string {
    const parts = (Object.keys(FIDELITY_RANK) as MatrixFidelity[])
        .filter(fidelity => matrix.totals[fidelity])
        .map(fidelity => `${matrix.totals[fidelity]!.cameras} ${fidelity}`)
    const network = matrix.cameras.filter(camera => camera.ptpIp).length
    return `${matrix.cameras.length} cameras: ${parts.join(', ')}.${network ? ` ${network} also simulated over PTP/IP (Wi-Fi).` : ''}${matrix.revision ? ` Revision \`${matrix.revision}\`.` : ''}${
        matrix.sources.hardwareGeneratedAt
            ? ` Hardware results from ${matrix.sources.hardwareGeneratedAt.slice(0, 10)}.`
            : ' No hardware results yet.'
    }`
}

/** The full merged matrix: verified cameras in full, documented ones rolled up per line and listed in full. */
export function renderCompatibility(matrix: CompatibilityMatrix): string {
    const verified = matrix.cameras.filter(camera => camera.fidelity !== 'documented')
    const documented = matrix.cameras.filter(camera => camera.fidelity === 'documented')
    return [
        '## Camera compatibility matrix',
        '',
        summary(matrix),
        '',
        LEGEND,
        '',
        ...cameraTable(matrix, verified),
        '',
        `### Documented cameras by line (${documented.length})`,
        '',
        ...lineRollup(matrix, documented),
        '',
        '<details><summary>Every documented camera</summary>',
        '',
        ...cameraTable(matrix, documented),
        '',
        '</details>',
        '',
    ].join('\n')
}

export const README_START = '<!-- camera-compatibility:start -->'
export const README_END = '<!-- camera-compatibility:end -->'

/** The README section: verified cameras in full and documented coverage rolled up per line. */
export function renderReadmeCompatibility(matrix: CompatibilityMatrix): string {
    const verified = matrix.cameras.filter(camera => camera.fidelity !== 'documented')
    const documented = matrix.cameras.filter(camera => camera.fidelity === 'documented')
    return [
        README_START,
        '',
        '<!-- Generated by `bun run --cwd packages/link compat:readme`; edit the generator, not this section. -->',
        '',
        '### Camera compatibility matrix',
        '',
        summary(matrix),
        '',
        LEGEND,
        '',
        ...cameraTable(matrix, verified),
        '',
        `<details><summary>Documented cameras by line (${documented.length} cameras, not hardware-verified)</summary>`,
        '',
        ...lineRollup(matrix, documented),
        '',
        '</details>',
        '',
        README_END,
    ].join('\n')
}

/** Replaces the text between the README markers; throws when the markers are missing. */
export function replaceReadmeSection(readme: string, section: string): string {
    const start = readme.indexOf(README_START)
    const end = readme.indexOf(README_END)
    if (start < 0 || end < start) throw new Error(`README needs ${README_START} and ${README_END} markers`)
    return `${readme.slice(0, start)}${section}${readme.slice(end + README_END.length)}`
}
