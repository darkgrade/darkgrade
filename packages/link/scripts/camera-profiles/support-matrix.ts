import type { ProfileFidelity } from '@transport/simulated/camera-profile'

export type CapabilityStatus = 'pass' | 'fail' | 'unsupported' | 'no-data'
/** "hardware" rows come from the device-lab tier running the same capabilities against a physical camera. */
export type MatrixFidelity = ProfileFidelity | 'hardware'
export type StatusCounts = Record<CapabilityStatus, number>

export interface CapabilityResult {
    status: CapabilityStatus
    detail: string
}

export interface SupportMatrixRow {
    profile: string
    path: string
    manufacturer: string
    line: string
    model: string
    fidelity: MatrixFidelity
    firmware?: string
    catalogLine?: string
    /** USB identities as "vvvv:pppp", used to match rows for the same camera across tiers. */
    usb?: string[]
    /** Documented rows: a line mock (one per catalog line) or a per-model mock generated from the catalog. */
    scope?: 'line' | 'model'
    /** Hardware rows: the cameras.lab.json entry and bench host that produced them. */
    labCamera?: string
    host?: string
    quirks: { total: number; simulated: number; unverified: number }
    results: Record<string, CapabilityResult>
}

/** One catalog line and the profiles that cover it. */
export interface SupportMatrixLine {
    manufacturer: string
    line: string
    protocolFamily: string
    modelCount: number
    capturedProfiles: string[]
    documentedProfile?: string
    note?: string
}

export interface SupportMatrix {
    generatedAt: string
    revision?: string
    capabilities: { id: string; label: string }[]
    rows: SupportMatrixRow[]
    lines: SupportMatrixLine[]
    /** Per fidelity, over line-scope rows; per-model documented rows are counted in `catalogModels`. */
    totals: Partial<Record<MatrixFidelity, StatusCounts>>
    /** Per-model documented mocks generated from the catalog at test time. */
    catalogModels?: {
        simulated: number
        skipped: { manufacturer: string; line: string; model: string; reason: string }[]
        totals: StatusCounts
    }
}

export function emptyStatusCounts(): StatusCounts {
    return { pass: 0, fail: 0, unsupported: 0, 'no-data': 0 }
}

export function countStatuses(
    rows: { results: Record<string, CapabilityResult> }[],
    capability?: string
): StatusCounts {
    const counts = emptyStatusCounts()
    for (const row of rows) {
        for (const [id, result] of Object.entries(row.results)) {
            if (capability === undefined || id === capability) counts[result.status] += 1
        }
    }
    return counts
}

const STATUS_LABELS: Record<CapabilityStatus, string> = {
    pass: 'pass',
    fail: '**FAIL**',
    unsupported: 'unsupported',
    'no-data': 'no data',
}

/** One BigQuery-ready record per row and capability. */
export interface CapabilityRecord {
    revision: string | null
    tier: string
    generated_at: string
    profile: string
    manufacturer: string
    line: string
    model: string
    fidelity: MatrixFidelity
    scope: string | null
    firmware: string | null
    host: string | null
    usb: string | null
    capability: string
    status: CapabilityStatus
    detail: string
}

export function capabilityRecords(matrix: SupportMatrix, tier: string, revision?: string): CapabilityRecord[] {
    return matrix.rows.flatMap(row =>
        Object.entries(row.results).map(([capability, result]) => ({
            revision: revision ?? matrix.revision ?? null,
            tier,
            generated_at: matrix.generatedAt,
            profile: row.profile,
            manufacturer: row.manufacturer,
            line: row.line,
            model: row.model,
            fidelity: row.fidelity,
            scope: row.scope ?? null,
            firmware: row.firmware ?? null,
            host: row.host ?? null,
            usb: row.usb?.join(',') ?? null,
            capability,
            status: result.status,
            detail: result.detail,
        }))
    )
}

function escapeCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function tableRow(cells: string[]): string {
    return `| ${cells.map(escapeCell).join(' | ')} |`
}

function table(header: string[], rows: string[][]): string[] {
    return [tableRow(header), tableRow(header.map(() => '---')), ...rows.map(tableRow)]
}

function totalsLine(totals: StatusCounts | undefined): string {
    if (!totals) return 'no results'
    return (Object.keys(STATUS_LABELS) as CapabilityStatus[])
        .map(status => `${totals[status]} ${STATUS_LABELS[status].replace(/\*/g, '').toLowerCase()}`)
        .join(' · ')
}

function fidelityCell(row: SupportMatrixRow): string {
    if (row.fidelity === 'hardware') return row.host ? `hardware (${row.host})` : 'hardware'
    if (row.fidelity === 'captured') return 'captured'
    const unverified = row.quirks.unverified ? `, ${row.quirks.unverified} unverified quirks` : ''
    return `documented${unverified}`
}

function capabilityTable(matrix: SupportMatrix, rows: SupportMatrixRow[]): string[] {
    return table(
        ['Manufacturer', 'Line', 'Model', 'Fidelity', 'Quirks simulated', ...matrix.capabilities.map(c => c.label)],
        rows.map(row => [
            row.manufacturer,
            row.line,
            row.firmware ? `${row.model} (fw ${row.firmware})` : row.model,
            fidelityCell(row),
            `${row.quirks.simulated}/${row.quirks.total}`,
            ...matrix.capabilities.map(capability => STATUS_LABELS[row.results[capability.id]?.status ?? 'no-data']),
        ])
    )
}

function compactCounts(counts: StatusCounts): string {
    const parts = [`${counts.pass} pass`]
    if (counts.fail) parts.push(`**${counts.fail} fail**`)
    if (counts.unsupported) parts.push(`${counts.unsupported} unsup.`)
    if (counts['no-data']) parts.push(`${counts['no-data']} no data`)
    return parts.join(', ')
}

/** Per-model documented mocks rolled up by catalog line, with the full per-model table collapsed. */
function catalogModelSection(matrix: SupportMatrix, rows: SupportMatrixRow[]): string[] {
    if (!matrix.catalogModels) return []
    const byLine = new Map<string, SupportMatrixRow[]>()
    for (const row of rows) {
        const key = `${row.manufacturer}\u0000${row.catalogLine ?? row.line}`
        byLine.set(key, [...(byLine.get(key) ?? []), row])
    }
    const skippedByLine = new Map<string, number>()
    for (const skip of matrix.catalogModels.skipped) {
        const key = `${skip.manufacturer.replace(/ \(other\)$/, '')}\u0000${skip.line}`
        skippedByLine.set(key, (skippedByLine.get(key) ?? 0) + 1)
    }
    const rollup = [...byLine.entries()].map(([key, lineRows]) => {
        const [manufacturer, line] = key.split('\u0000') as [string, string]
        return [
            manufacturer,
            lineRows[0]?.line ?? line,
            String(lineRows.length),
            String(skippedByLine.get(key) ?? 0),
            ...matrix.capabilities.map(capability => compactCounts(countStatuses(lineRows, capability.id))),
        ]
    })
    const { simulated, skipped, totals } = matrix.catalogModels
    return [
        `### Documented per-model mocks (${simulated} models)`,
        '',
        `**Not hardware-verified.** One mock per catalog model with a USB product ID: each inherits its line's quirks, keeps only the line quirks the catalog scopes to that model or to a libgphoto2 flag it carries, and adds its own libgphoto2 device flags. ${skipped.length} catalog models were skipped (${[...new Set(skipped.map(skip => skip.reason))].join('; ')}). ${totalsLine(totals)}.`,
        '',
        ...table(
            ['Manufacturer', 'Line', 'Models', 'Skipped', ...matrix.capabilities.map(capability => capability.label)],
            rollup
        ),
        '',
        '<details><summary>Every per-model mock</summary>',
        '',
        ...capabilityTable(matrix, rows),
        '',
        '</details>',
        '',
    ]
}

function findings(matrix: SupportMatrix, rows: SupportMatrixRow[], statuses: CapabilityStatus[]): string[] {
    return rows.flatMap(row =>
        matrix.capabilities.flatMap(capability => {
            const result = row.results[capability.id]
            if (!result || !statuses.includes(result.status)) return []
            return [
                `- **${row.model}** · ${capability.label} · ${STATUS_LABELS[result.status]}: ${escapeCell(result.detail)}`,
            ]
        })
    )
}

export function renderSupportMatrix(matrix: SupportMatrix): string {
    const order = (left: SupportMatrixRow, right: SupportMatrixRow) =>
        left.manufacturer.localeCompare(right.manufacturer) ||
        left.line.localeCompare(right.line) ||
        left.model.localeCompare(right.model)
    const hardware = matrix.rows.filter(row => row.fidelity === 'hardware').sort(order)
    const captured = matrix.rows.filter(row => row.fidelity === 'captured').sort(order)
    const documented = matrix.rows.filter(row => row.fidelity === 'documented' && row.scope !== 'model').sort(order)
    const models = matrix.rows.filter(row => row.fidelity === 'documented' && row.scope === 'model').sort(order)
    const hardwareSection = hardware.length
        ? [
              `### Physical cameras on the device lab (${hardware.length} cameras)`,
              '',
              `The same capabilities run against real bodies on the testbench. ${totalsLine(matrix.totals.hardware)}. Recorded-traffic replay is disabled on hardware.`,
              '',
              ...capabilityTable(matrix, hardware),
              ...findings(matrix, hardware, ['fail', 'unsupported']).map((line, index) =>
                  index === 0 ? `\n${line}` : line
              ),
              '',
          ]
        : []
    const lineRows = matrix.lines.map(line => [
        line.manufacturer,
        line.line,
        line.protocolFamily,
        String(line.modelCount),
        line.capturedProfiles.join(', ') || '-',
        line.documentedProfile ?? '-',
        line.note ?? '',
    ])

    const capturedSection = captured.length
        ? [
              `### Captured from testbench hardware (${captured.length} profiles)`,
              '',
              `Replays evidence recorded on the darkgrade testbench. ${totalsLine(matrix.totals.captured)}. A failure here is a darkgrade regression and fails CI.`,
              '',
              ...capabilityTable(matrix, captured),
              ...findings(matrix, captured, ['fail', 'unsupported']).map((line, index) =>
                  index === 0 ? `\n${line}` : line
              ),
              '',
          ]
        : []
    const documentedSection = documented.length
        ? [
              `### Documented mocks, one per camera line (${documented.length} profiles)`,
              '',
              `**Not hardware-verified.** Built from public references (libgphoto2 tables pinned at commit 02d92fe, vendor SDK pages); they show how darkgrade reacts to each line's documented protocol and where it has no definitions. ${totalsLine(matrix.totals.documented)}.`,
              '',
              ...capabilityTable(matrix, documented),
              '',
              '<details><summary>Documented-mock findings</summary>',
              '',
              ...findings(matrix, documented, ['fail', 'unsupported']),
              '',
              '</details>',
              '',
          ]
        : []
    const linesSection = matrix.lines.length
        ? [
              '### Coverage by catalog line',
              '',
              'Model counts and USB identities come from `camera-catalog/camera-lines.json`. Vendor SDK model lists in the catalog are taken from search summaries and are marked unverified; lines whose protocol is "Standard PTP" or "unknown" have no documented vendor control protocol.',
              '',
              ...table(
                  ['Manufacturer', 'Line', 'Protocol', 'Models', 'Captured profiles', 'Documented mock', 'Note'],
                  lineRows
              ),
              '',
          ]
        : []

    return [
        hardware.length && !captured.length ? '## Device-lab camera matrix' : '## Simulated camera support matrix',
        '',
        `${matrix.revision ? `Revision \`${matrix.revision}\`. ` : ''}"no data" means the profile holds no response for that capability; the simulator never invents one.`,
        '',
        ...hardwareSection,
        ...capturedSection,
        ...documentedSection,
        ...catalogModelSection(matrix, models),
        ...linesSection,
    ].join('\n')
}
