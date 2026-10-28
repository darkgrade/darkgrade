import type { ProfileFidelity } from '@transport/simulated/camera-profile'

export type CapabilityStatus = 'pass' | 'fail' | 'unsupported' | 'no-data'

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
    fidelity: ProfileFidelity
    firmware?: string
    catalogLine?: string
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
    totals: Record<ProfileFidelity, Record<CapabilityStatus, number>>
}

const STATUS_LABELS: Record<CapabilityStatus, string> = {
    pass: 'pass',
    fail: '**FAIL**',
    unsupported: 'unsupported',
    'no-data': 'no data',
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

function totalsLine(totals: Record<CapabilityStatus, number>): string {
    return (Object.keys(STATUS_LABELS) as CapabilityStatus[])
        .map(status => `${totals[status]} ${STATUS_LABELS[status].replace(/\*/g, '').toLowerCase()}`)
        .join(' · ')
}

function fidelityCell(row: SupportMatrixRow): string {
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
    const captured = matrix.rows.filter(row => row.fidelity === 'captured').sort(order)
    const documented = matrix.rows.filter(row => row.fidelity === 'documented').sort(order)
    const lineRows = matrix.lines.map(line => [
        line.manufacturer,
        line.line,
        line.protocolFamily,
        String(line.modelCount),
        line.capturedProfiles.join(', ') || '-',
        line.documentedProfile ?? '-',
        line.note ?? '',
    ])

    return [
        '## Simulated camera support matrix',
        '',
        `${matrix.revision ? `Revision \`${matrix.revision}\`. ` : ''}"no data" means the profile holds no response for that capability; the simulator never invents one.`,
        '',
        `### Captured from testbench hardware (${captured.length} profiles)`,
        '',
        `Replays evidence recorded on the darkgrade testbench. ${totalsLine(matrix.totals.captured)}. A failure here is a darkgrade regression and fails CI.`,
        '',
        ...capabilityTable(matrix, captured),
        ...findings(matrix, captured, ['fail', 'unsupported']).map((line, index) => (index === 0 ? `\n${line}` : line)),
        '',
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
        '### Coverage by catalog line',
        '',
        'Model counts and USB identities come from `camera-catalog/camera-lines.json`. Vendor SDK model lists in the catalog are taken from search summaries and are marked unverified; lines whose protocol is "Standard PTP" or "unknown" have no documented vendor control protocol.',
        '',
        ...table(
            ['Manufacturer', 'Line', 'Protocol', 'Models', 'Captured profiles', 'Documented mock', 'Note'],
            lineRows
        ),
        '',
    ].join('\n')
}
