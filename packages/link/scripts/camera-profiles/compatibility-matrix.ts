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

export interface CapabilityEvidence {
    fidelity: MatrixFidelity
    profile: string
    firmware?: string
    host?: string
    generatedAt: string
    revision?: string
    conflicts?: (Omit<CapabilityEvidence, 'conflicts'> & CapabilityResult)[]
}

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
    /** Network-only cameras retain their results without implying a USB test. */
    primaryTransport?: 'ptp-ip'
    firmware?: string
    host?: string
    /** Weaker evidence for the same camera that the chosen row supersedes. */
    alsoCoveredBy: { fidelity: MatrixFidelity; profile: string }[]
    results: Record<string, CapabilityResult>
    /** The same camera reached over standard PTP/IP, when it was simulated there. */
    ptpIp?: {
        fidelity: MatrixFidelity
        profile: string
        results: Record<string, CapabilityResult>
        firmware?: string
        host?: string
        generatedAt: string
        revision?: string
        resultEvidence: CompatibilityCamera['resultEvidence']
    }
    /** Source of each selected capability; camera-level fidelity does not promote weaker results. */
    resultEvidence: Record<string, CapabilityEvidence>
}

export interface CompatibilityMatrix {
    generatedAt: string
    revision?: string
    capabilities: { id: string; label: string }[]
    sources: {
        simulation?: string
        hardware?: string
        hardwareGeneratedAt?: string
        hardwareOldestGeneratedAt?: string
    }
    cameras: CompatibilityCamera[]
    totals: Partial<Record<MatrixFidelity, { cameras: number } & StatusCounts>>
}

const normalizeIdentity = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ')

/** Catalog aliases apply only within the row's declared manufacturer and product line. */
function modelIdentity(row: SupportMatrixRow, usb: string): string {
    const [vendorId, productId] = usb.split(':').map(value => Number.parseInt(value, 16))
    const identified = identifyCamera({ vendorId, productId, ptpModel: row.model })
    const candidate = identified.status === 'matched' ? identified.candidates[0] : undefined
    const manufacturer = normalizeIdentity(row.manufacturer)
    const line = normalizeIdentity(row.catalogLine ?? row.line)
    const matches =
        candidate &&
        normalizeIdentity(candidate.manufacturer) === manufacturer &&
        normalizeIdentity(candidate.line) === line
    return `${manufacturer}|${line}|${normalizeIdentity(matches ? candidate.models[0] : row.model)}`
}

type ObservedRow = SupportMatrixRow & { source: { generatedAt: string; revision?: string } }

/** Group all transports, but never borrow results from a different or unknown firmware version. */
function groupCameras(rows: ObservedRow[]): ObservedRow[][] {
    const parent = rows.map((_, index) => index)
    const find = (index: number): number => (parent[index] === index ? index : (parent[index] = find(parent[index])))
    const owners = new Map<string, number>()
    rows.forEach((row, index) => {
        const identities = row.usb?.length
            ? row.usb.map(usb => {
                  const identity = usb.toLowerCase()
                  if (!/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(identity)) throw new Error(`Invalid report USB identity ${usb}`)
                  return `${modelIdentity(row, identity)}|${identity}`
              })
            : [
                  `${normalizeIdentity(row.manufacturer)}|${normalizeIdentity(row.catalogLine ?? row.line)}|${normalizeIdentity(row.model)}|profile:${row.profile}`,
              ]
        for (const identity of identities) {
            const key = `${identity}|firmware:${row.firmware ?? ''}`
            const existing = owners.get(key)
            if (existing === undefined) owners.set(key, index)
            else parent[find(index)] = find(existing)
        }
    })
    const groups = new Map<number, ObservedRow[]>()
    rows.forEach((row, index) => groups.set(find(index), [...(groups.get(find(index)) ?? []), row]))
    return [...groups.values()]
}

const observedAt = (row: ObservedRow) => Date.parse(row.source.generatedAt) || 0
const evidenceOrder = (left: ObservedRow, right: ObservedRow) =>
    FIDELITY_RANK[right.fidelity] - FIDELITY_RANK[left.fidelity] ||
    observedAt(right) - observedAt(left) ||
    left.profile.localeCompare(right.profile)

function evidenceFor(row: ObservedRow): CapabilityEvidence {
    return {
        fidelity: row.fidelity,
        profile: row.profile,
        generatedAt: row.source.generatedAt,
        ...(row.firmware && { firmware: row.firmware }),
        ...(row.host && { host: row.host }),
        ...(row.source.revision && { revision: row.source.revision }),
    }
}

/** Each transport/capability chooses its own source; equal-time contradictions stay visible. */
function selectResults(rows: ObservedRow[], capabilities: SupportMatrix['capabilities']) {
    const ordered = [...rows].sort(evidenceOrder)
    const results: CompatibilityCamera['results'] = {}
    const resultEvidence: CompatibilityCamera['resultEvidence'] = {}
    for (const capability of capabilities) {
        const known = ordered.filter(
            row => row.results[capability.id] && row.results[capability.id].status !== 'no-data'
        )
        const selected = known[0] ?? ordered.find(row => row.results[capability.id])
        if (!selected) continue
        const peers = known.filter(
            row => row.fidelity === selected.fidelity && observedAt(row) === observedAt(selected)
        )
        const conflict = new Set(peers.map(row => row.results[capability.id].status)).size > 1
        results[capability.id] = conflict
            ? {
                  status: 'no-data',
                  detail: `Conflicting ${selected.fidelity} results at the same observation time; inspect resultEvidence.conflicts`,
              }
            : selected.results[capability.id]
        resultEvidence[capability.id] = {
            ...evidenceFor(selected),
            ...(conflict && { conflicts: peers.map(row => ({ ...evidenceFor(row), ...row.results[capability.id] })) }),
        }
    }
    return { results, resultEvidence }
}

function observe(matrix: SupportMatrix): ObservedRow[] {
    return matrix.rows.map(row => ({
        ...row,
        source: row.source ?? {
            generatedAt: matrix.generatedAt,
            ...(matrix.revision && { revision: matrix.revision }),
        },
    }))
}

export function mergeCompatibility(
    simulation: SupportMatrix,
    hardware?: SupportMatrix,
    sources: CompatibilityMatrix['sources'] = {}
): CompatibilityMatrix {
    const observedSimulation = observe(simulation)
    const modelMocks = observedSimulation.filter(row => row.scope === 'model')
    // Filtered runs may contain model mocks for only one line or one representative body.
    // Drop a line mock only when that exact model/USB/firmware is already represented.
    const simulated = observedSimulation.filter(
        row =>
            row.scope !== 'line' ||
            !modelMocks.some(
                model =>
                    model.firmware === row.firmware &&
                    row.usb?.some(
                        usb => model.usb?.includes(usb) && modelIdentity(model, usb) === modelIdentity(row, usb)
                    )
            )
    )
    const observedHardware = hardware ? observe(hardware).filter(row => row.fidelity === 'hardware') : []
    const rows = [...observedHardware, ...simulated]
    const capabilities = [
        ...new Map(
            [
                ...simulation.capabilities,
                ...(hardware?.capabilities ?? []),
                ...rows.flatMap(row => Object.keys(row.results).map(id => ({ id, label: id }))),
            ]
                .reverse()
                .map(capability => [capability.id, capability])
        ).values(),
    ].reverse()
    const cameras = groupCameras(rows).map(group => {
        const usbRows = group.filter(row => row.transport !== 'ptp-ip')
        const networkRows = group.filter(row => row.transport === 'ptp-ip')
        const primaryRows = usbRows.length ? usbRows : networkRows
        const chosen = [...primaryRows].sort(evidenceOrder)[0]
        const network = usbRows.length && networkRows.length ? [...networkRows].sort(evidenceOrder)[0] : undefined
        const networkResults = network ? selectResults(networkRows, capabilities) : undefined
        const models = [...new Set(group.map(row => row.model))]
        return {
            manufacturer: chosen.manufacturer,
            line: chosen.line,
            ...(chosen.catalogLine && { catalogLine: chosen.catalogLine }),
            model: chosen.model,
            aliases: models.filter(model => model !== chosen.model),
            fidelity: chosen.fidelity,
            profile: chosen.profile,
            usb: [...new Set(group.flatMap(row => row.usb ?? []).map(usb => usb.toLowerCase()))].sort(),
            ...(!usbRows.length && { primaryTransport: 'ptp-ip' as const }),
            ...(chosen.firmware && { firmware: chosen.firmware }),
            ...(chosen.host && { host: chosen.host }),
            alsoCoveredBy: group
                .filter(row => row !== chosen)
                .map(row => ({ fidelity: row.fidelity, profile: row.profile })),
            ...selectResults(primaryRows, capabilities),
            ...(network &&
                networkResults && {
                    ptpIp: {
                        fidelity: network.fidelity,
                        profile: network.profile,
                        ...networkResults,
                        ...(network.firmware && { firmware: network.firmware }),
                        ...(network.host && { host: network.host }),
                        generatedAt: network.source.generatedAt,
                        ...(network.source.revision && { revision: network.source.revision }),
                    },
                }),
        } satisfies CompatibilityCamera
    })
    cameras.sort(
        (left, right) =>
            FIDELITY_RANK[right.fidelity] - FIDELITY_RANK[left.fidelity] ||
            left.manufacturer.localeCompare(right.manufacturer) ||
            left.line.localeCompare(right.line) ||
            left.model.localeCompare(right.model) ||
            (left.firmware ?? '').localeCompare(right.firmware ?? '')
    )
    const totals: CompatibilityMatrix['totals'] = {}
    for (const fidelity of Object.keys(FIDELITY_RANK) as MatrixFidelity[]) {
        const matching = cameras.filter(camera => camera.fidelity === fidelity)
        if (matching.length) totals[fidelity] = { cameras: matching.length, ...countStatuses(matching) }
    }
    return {
        generatedAt: new Date().toISOString(),
        ...(simulation.revision && { revision: simulation.revision }),
        capabilities,
        sources: {
            ...sources,
            ...(observedHardware.length && {
                hardwareGeneratedAt: [...observedHardware].sort(
                    (left, right) => observedAt(right) - observedAt(left)
                )[0].source.generatedAt,
                hardwareOldestGeneratedAt: [...observedHardware].sort(
                    (left, right) => observedAt(left) - observedAt(right)
                )[0].source.generatedAt,
            }),
        },
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
        'Transport',
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
                camera.primaryTransport ?? 'usb',
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
    const network = matrix.cameras.filter(camera => camera.ptpIp || camera.primaryTransport === 'ptp-ip').length
    return `${matrix.cameras.length} cameras: ${parts.join(', ')}.${network ? ` ${network} have PTP/IP results.` : ''}${matrix.revision ? ` Revision \`${matrix.revision}\`.` : ''}${
        matrix.sources.hardwareGeneratedAt
            ? ` Hardware observation dates ${matrix.sources.hardwareOldestGeneratedAt?.slice(0, 10) ?? matrix.sources.hardwareGeneratedAt.slice(0, 10)} through ${matrix.sources.hardwareGeneratedAt.slice(0, 10)}.`
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
