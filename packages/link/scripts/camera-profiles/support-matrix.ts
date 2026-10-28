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
    results: Record<string, CapabilityResult>
}

export interface SupportMatrix {
    generatedAt: string
    revision?: string
    capabilities: { id: string; label: string }[]
    rows: SupportMatrixRow[]
    totals: Record<CapabilityStatus, number>
}

const STATUS_LABELS: Record<CapabilityStatus, string> = {
    pass: 'pass',
    fail: '**FAIL**',
    unsupported: 'unsupported',
    'no-data': 'no data',
}

const FIDELITY_LABELS: Record<ProfileFidelity, string> = {
    captured: 'captured',
    documented: 'documented (not hardware-verified)',
}

function escapeCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function renderSupportMatrix(matrix: SupportMatrix): string {
    const header = [
        'Manufacturer',
        'Line',
        'Model',
        'Fidelity',
        ...matrix.capabilities.map(capability => capability.label),
    ]
    const rows = [...matrix.rows].sort(
        (left, right) =>
            left.fidelity.localeCompare(right.fidelity) ||
            left.manufacturer.localeCompare(right.manufacturer) ||
            left.line.localeCompare(right.line) ||
            left.model.localeCompare(right.model)
    )
    const table = [
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows
            .map(row =>
                [
                    row.manufacturer,
                    row.line,
                    row.firmware ? `${row.model} (fw ${row.firmware})` : row.model,
                    FIDELITY_LABELS[row.fidelity],
                    ...matrix.capabilities.map(
                        capability => STATUS_LABELS[row.results[capability.id]?.status ?? 'no-data']
                    ),
                ]
                    .map(escapeCell)
                    .join(' | ')
            )
            .map(line => `| ${line} |`),
    ]

    const findings = rows.flatMap(row =>
        matrix.capabilities.flatMap(capability => {
            const result = row.results[capability.id]
            if (!result || result.status === 'pass' || result.status === 'no-data') return []
            return [
                `- **${row.model}** · ${capability.label} · ${STATUS_LABELS[result.status]}: ${escapeCell(result.detail)}`,
            ]
        })
    )

    const totals = (Object.keys(STATUS_LABELS) as CapabilityStatus[])
        .map(status => `${matrix.totals[status]} ${STATUS_LABELS[status].replace(/\*/g, '').toLowerCase()}`)
        .join(' · ')

    return [
        '## Simulated camera support matrix',
        '',
        `${matrix.rows.length} profiles · ${totals}${matrix.revision ? ` · revision \`${matrix.revision}\`` : ''}`,
        '',
        '"captured" rows replay real testbench evidence; "documented" rows are built from vendor documentation and prove nothing about hardware. "no data" means the profile holds no captured response for that capability.',
        '',
        ...table,
        ...(findings.length ? ['', '### Failures and unsupported capabilities', '', ...findings] : []),
        '',
    ].join('\n')
}
