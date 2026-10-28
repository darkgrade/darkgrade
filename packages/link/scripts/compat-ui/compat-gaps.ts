/**
 * What is left to do, per manufacturer and line: darkgrade library gaps (vendor operations it has no
 * definition for, recorded parameters its definitions cannot express, missing vendor classes) and
 * data gaps (no-data cells, unverified catalog entries, models or lines with no mock or no capture).
 * Built from the catalog and a support matrix; rendered as GAPS.md and as the UI's /gaps page.
 */
import type { CameraCatalog, CatalogLine, CatalogManufacturer } from '@scripts/camera-profiles/camera-catalog'
import { shortLineName } from '@scripts/camera-profiles/catalog-names'
import type { SupportMatrix, SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'

export interface LineGaps {
    manufacturer: string
    line: string
    catalogLine: string
    protocolFamily: string
    models: number
    mockedModels: number
    skippedModels: { model: string; reason: string }[]
    capturedProfiles: string[]
    hardwareProfiles: string[]
    documentedMock?: string
    /** Vendor opcodes the line's profiles document that darkgrade has no definition for. */
    undefinedVendorOperations: string[]
    /** Recorded requests whose parameters darkgrade's operation definitions cannot express. */
    inexpressibleRequests: string[]
    /** Events the profiles document that darkgrade has no definition for. */
    undefinedEvents: string[]
    noDataCells: number
    cells: number
    /** The first request each profile could not answer, which says what to capture next. */
    missingResponses: string[]
    unverifiedModels: string[]
    unverifiedQuirks: string[]
    ptpIp?: string
}

export interface ManufacturerGaps {
    name: string
    usbVendorId: string | null
    /** darkgrade has vendor operation and property definitions for this manufacturer. */
    vendorDefinitions: boolean
    lines: LineGaps[]
}

export interface GapReport {
    matrixGeneratedAt?: string
    manufacturers: ManufacturerGaps[]
    /** The catalog's darkgradeGaps notes, verbatim. */
    libraryNotes: { key: string; items: string[] }[]
    totals: {
        undefinedVendorOperations: number
        inexpressibleRequests: number
        linesWithoutMock: number
        linesWithoutCapture: number
        noDataCells: number
        cells: number
        unverifiedModels: number
        unverifiedQuirks: number
        skippedModels: number
    }
}

const DEFINED_VENDORS = ['canon', 'nikon', 'sony']

function codesAfter(detail: string, marker: string): string[] {
    const index = detail.indexOf(marker)
    if (index < 0) return []
    return (
        detail
            .slice(index + marker.length)
            .split(';')[0]
            .match(/0x[0-9a-f]+/g) ?? []
    )
}

function inexpressible(detail: string): string[] {
    const index = detail.indexOf('parameters not expressible:')
    if (index < 0) return []
    const text = detail.slice(index + 'parameters not expressible:'.length).split(';')[0]
    return text.match(/0x[0-9a-f]+(?: \[[^\]]*\])?/g) ?? []
}

function unique(values: string[]): string[] {
    return [...new Set(values)].sort()
}

function lineGaps(
    manufacturer: CatalogManufacturer,
    line: CatalogLine,
    rows: SupportMatrixRow[],
    matrix: SupportMatrix | undefined
): LineGaps {
    const usbRows = rows.filter(row => row.transport !== 'ptp-ip')
    const detail = (capability: string) => usbRows.map(row => row.results[capability]?.detail ?? '')
    const cells = usbRows.flatMap(row => Object.values(row.results))
    const missing = usbRows.flatMap(row => {
        const first = Object.values(row.results).find(result => result.status === 'no-data')?.detail
        const match = first?.match(/no captured response for (0x[0-9a-f]+(?: \[[^\]]*\])?)/)
        return match ? [match[1]] : []
    })
    const skipped = matrix?.catalogModels?.skipped.filter(skip => skip.line === line.name) ?? []
    const ptpIp = matrix?.ptpIp?.notSimulated.find(
        entry => entry.manufacturer === manufacturer.name && line.name.startsWith(entry.line)
    )
    const simulatedOverPtpIp = rows.some(row => row.transport === 'ptp-ip')
    const documentedMock = usbRows.find(row => row.scope === 'line')?.profile
    return {
        manufacturer: manufacturer.name,
        line: shortLineName(manufacturer, line),
        catalogLine: line.name,
        protocolFamily: line.protocolFamily,
        models: line.models.length,
        mockedModels: usbRows.filter(row => row.scope === 'model').length,
        skippedModels: skipped.map(skip => ({ model: skip.model, reason: skip.reason })),
        capturedProfiles: unique(usbRows.filter(row => row.fidelity === 'captured').map(row => row.profile)),
        hardwareProfiles: unique(rows.filter(row => row.fidelity === 'hardware').map(row => row.profile)),
        ...(documentedMock && { documentedMock }),
        undefinedVendorOperations: unique(
            detail('vendor-operations').flatMap(text => codesAfter(text, 'no darkgrade definition for'))
        ),
        inexpressibleRequests: unique(detail('recorded-exchanges').flatMap(inexpressible)),
        undefinedEvents: unique(
            detail('events').flatMap(text => codesAfter(text, 'darkgrade has no definition for event'))
        ),
        noDataCells: cells.filter(cell => cell.status === 'no-data').length,
        cells: cells.length,
        missingResponses: unique(missing),
        unverifiedModels: line.models.filter(model => model.unverified).map(model => model.name),
        unverifiedQuirks: line.quirks.filter(quirk => quirk.unverified).map(quirk => quirk.id),
        ...(simulatedOverPtpIp ? { ptpIp: 'simulated' } : ptpIp ? { ptpIp: ptpIp.reason } : {}),
    }
}

export function buildGapReport(catalog: CameraCatalog, matrices: SupportMatrix[]): GapReport {
    const simulation = matrices.find(matrix => matrix.catalogModels) ?? matrices[0]
    const rows = matrices.flatMap(matrix => matrix.rows)
    const manufacturers = catalog.manufacturers.map(manufacturer => {
        const name = manufacturer.name.replace(/ \(other\)$/, '')
        return {
            name,
            usbVendorId: manufacturer.usbVendorId,
            vendorDefinitions: DEFINED_VENDORS.some(vendor => name.toLowerCase().startsWith(vendor)),
            lines: manufacturer.lines.map(line =>
                lineGaps(
                    manufacturer,
                    line,
                    rows.filter(row => row.catalogLine === line.name),
                    simulation
                )
            ),
        }
    })
    const lines = manufacturers.flatMap(manufacturer => manufacturer.lines)
    const libraryNotes = Object.entries(catalog.darkgradeGaps)
        .filter(([, value]) => Array.isArray(value))
        .map(([key, value]) => ({ key, items: (value as unknown[]).map(String) }))
    return {
        ...(simulation && { matrixGeneratedAt: simulation.generatedAt }),
        manufacturers,
        libraryNotes,
        totals: {
            undefinedVendorOperations: unique(lines.flatMap(line => line.undefinedVendorOperations)).length,
            inexpressibleRequests: unique(lines.flatMap(line => line.inexpressibleRequests)).length,
            linesWithoutMock: lines.filter(line => !line.documentedMock).length,
            linesWithoutCapture: lines.filter(line => !line.capturedProfiles.length && !line.hardwareProfiles.length)
                .length,
            noDataCells: lines.reduce((total, line) => total + line.noDataCells, 0),
            cells: lines.reduce((total, line) => total + line.cells, 0),
            unverifiedModels: lines.reduce((total, line) => total + line.unverifiedModels.length, 0),
            unverifiedQuirks: lines.reduce((total, line) => total + line.unverifiedQuirks.length, 0),
            skippedModels: lines.reduce((total, line) => total + line.skippedModels.length, 0),
        },
    }
}

/** The next step that would close a line's biggest data gap. */
export function nextStep(line: LineGaps): string {
    if (!line.documentedMock && line.skippedModels.length)
        return 'Find a USB product ID (usb.ids, libgphoto2) or capture one with `compat:ingest --capture`.'
    if (!line.capturedProfiles.length && !line.hardwareProfiles.length)
        return 'Run `compat:hardware --usb <vid:pid>` on a body and ingest a usbmon capture of connect + GetDeviceInfo.'
    if (line.missingResponses.length)
        return `Capture ${line.missingResponses.slice(0, 2).join(', ')} and ingest it with \`compat:ingest --capture\`.`
    if (line.unverifiedQuirks.length) return `Confirm ${line.unverifiedQuirks.join(', ')} on hardware.`
    return 'No data gap recorded.'
}

function percent(part: number, whole: number): string {
    return whole ? `${Math.round((part / whole) * 100)}%` : '-'
}

function cell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function renderGapsMarkdown(report: GapReport): string {
    const { totals } = report
    const lines = report.manufacturers.flatMap(manufacturer => manufacturer.lines)
    const library = lines.filter(
        line =>
            line.undefinedVendorOperations.length || line.inexpressibleRequests.length || line.undefinedEvents.length
    )
    return [
        '# Compatibility gaps',
        '',
        '<!-- Generated by `bun run --cwd packages/link compat:gaps`; edit the generator, not this file. -->',
        '',
        `From the camera catalog and the simulation matrix${report.matrixGeneratedAt ? ` of ${report.matrixGeneratedAt.slice(0, 10)}` : ''}. The same report is the \`/gaps\` page of \`bun run compat:ui\`.`,
        '',
        `- **Library:** ${totals.undefinedVendorOperations} vendor operations documented for some line have no darkgrade definition; ${totals.inexpressibleRequests} recorded requests have parameters darkgrade's definitions cannot express.`,
        `- **Data:** ${totals.noDataCells} of ${totals.cells} capability cells (${percent(totals.noDataCells, totals.cells)}) have no data. ${totals.linesWithoutCapture} of ${lines.length} lines have no captured or hardware evidence, and ${totals.linesWithoutMock} have no mock. ${totals.skippedModels} catalog models are not mocked.`,
        `- **Unverified:** ${totals.unverifiedModels} catalog models and ${totals.unverifiedQuirks} line quirks are marked unverified by their sources.`,
        '',
        '## darkgrade library gaps',
        '',
        'Vendor classes: ' +
            report.manufacturers
                .map(
                    manufacturer => `${manufacturer.name} ${manufacturer.vendorDefinitions ? 'defined' : '**missing**'}`
                )
                .join(' · ') +
            '.',
        '',
        '| Manufacturer | Line | Undefined vendor operations | Inexpressible recorded requests | Undefined events |',
        '| --- | --- | --- | --- | --- |',
        ...library.map(
            line =>
                `| ${cell(line.manufacturer)} | ${cell(line.line)} | ${line.undefinedVendorOperations.join(' ') || '-'} | ${line.inexpressibleRequests.join(', ') || '-'} | ${line.undefinedEvents.join(' ') || '-'} |`
        ),
        '',
        'The inexpressible requests above come from the recorded-exchange codec checks in this matrix; successfully encoded requests are omitted.',
        '',
        ...report.libraryNotes.flatMap(note => [
            `<details><summary>Catalog note: ${note.key} (${note.items.length})</summary>`,
            '',
            ...note.items.map(item => `- ${cell(item)}`),
            '',
            '</details>',
            '',
        ]),
        '## Data gaps',
        '',
        '| Manufacturer | Line | Models | Mocked | Captured / hardware | No-data cells | Unverified | PTP/IP | Next step |',
        '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...lines.map(line =>
            [
                '',
                cell(line.manufacturer),
                cell(line.line),
                String(line.models),
                `${line.mockedModels}${line.documentedMock ? '' : ' (no line mock)'}`,
                [...line.capturedProfiles, ...line.hardwareProfiles.map(profile => `${profile} (hw)`)].join(', ') ||
                    '-',
                `${line.noDataCells}/${line.cells}`,
                [
                    line.unverifiedModels.length && `${line.unverifiedModels.length} models`,
                    line.unverifiedQuirks.length && line.unverifiedQuirks.join(', '),
                ]
                    .filter(Boolean)
                    .join('; ') || '-',
                cell(line.ptpIp ?? '-'),
                cell(nextStep(line)),
                '',
            ]
                .join(' | ')
                .trim()
        ),
        '',
        '## Catalog models without a mock',
        '',
        ...lines.flatMap(line =>
            line.skippedModels.map(
                skip => `- ${cell(line.manufacturer)} · ${cell(line.line)} · ${cell(skip.model)}: ${skip.reason}`
            )
        ),
        '',
        '## Closing a gap',
        '',
        '1. Run `bun run compat:hardware -- --usb <vid:pid>` with the camera attached; it streams into `bun run compat:ui`.',
        '2. Record a usbmon capture of the missing requests (the `camera-re-capture` skill) and run `bun run compat:ingest -- --capture <profile-id>=<file.pcapng> --simulate`.',
        '3. Regenerate this file with `bun run compat:gaps`.',
        '',
    ].join('\n')
}

export type GapActionKind =
    | 'add-vendor-definitions'
    | 'define-operations'
    | 'extend-definitions'
    | 'define-events'
    | 'find-usb-ids'
    | 'add-line-mock'
    | 'run-hardware'
    | 'capture-responses'
    | 'verify-quirks'
    | 'verify-catalog'
    | 'configure-ptp-ip'

/** Something to change or configure to close a gap, with the command or skill that does it. */
export interface GapAction {
    kind: GapActionKind
    /** "library": darkgrade's code needs a change; "data": a profile, capture or catalog entry does. */
    area: 'library' | 'data'
    summary: string
    items?: string[]
    command?: string
}

function usbIdentityHint(usbVendorId: string | null): string {
    return usbVendorId ? `${usbVendorId.replace(/^0x/, '').padStart(4, '0')}:<pid>` : '<vid:pid>'
}

/** Every action that would close one of a line's gaps, library changes first. */
export function gapActions(
    line: LineGaps,
    manufacturer: Pick<ManufacturerGaps, 'vendorDefinitions' | 'usbVendorId'>
): GapAction[] {
    const actions: GapAction[] = []
    if (!manufacturer.vendorDefinitions && line.undefinedVendorOperations.length) {
        actions.push({
            kind: 'add-vendor-definitions',
            area: 'library',
            summary: `darkgrade has no vendor class for ${line.manufacturer}; add one under src/vendors/.`,
        })
    }
    if (line.undefinedVendorOperations.length) {
        actions.push({
            kind: 'define-operations',
            area: 'library',
            summary: `Define ${line.undefinedVendorOperations.length} vendor operations the ${line.line} profiles document.`,
            items: line.undefinedVendorOperations,
            command: 'camera-re-define skill (verify with camera-re-verify)',
        })
    }
    if (line.inexpressibleRequests.length) {
        actions.push({
            kind: 'extend-definitions',
            area: 'library',
            summary: 'Recorded requests use parameter values darkgrade’s definitions cannot express.',
            items: line.inexpressibleRequests,
            command: 'camera-re-define skill',
        })
    }
    if (line.undefinedEvents.length) {
        actions.push({
            kind: 'define-events',
            area: 'library',
            summary: `Define ${line.undefinedEvents.length} events the profiles document.`,
            items: line.undefinedEvents,
            command: 'camera-re-define skill',
        })
    }
    if (line.skippedModels.length) {
        actions.push({
            kind: 'find-usb-ids',
            area: 'data',
            summary: `${line.skippedModels.length} catalog models have no USB product ID, so they are not mocked.`,
            items: line.skippedModels.map(skip => `${skip.model}: ${skip.reason}`),
            command: 'bun run compat:ingest -- --capture <profile-id>=<file.pcapng>',
        })
    }
    if (!line.documentedMock) {
        actions.push({
            kind: 'add-line-mock',
            area: 'data',
            summary: 'No documented line mock; add the line to camera-catalog and run profiles:documented.',
            command: 'bun run profiles:documented',
        })
    }
    if (!line.capturedProfiles.length && !line.hardwareProfiles.length) {
        actions.push({
            kind: 'run-hardware',
            area: 'data',
            summary: 'No captured or hardware evidence for this line; run a body standalone and ingest a capture.',
            command: `bun run compat:hardware -- --usb ${usbIdentityHint(manufacturer.usbVendorId)}`,
        })
    }
    if (line.missingResponses.length) {
        actions.push({
            kind: 'capture-responses',
            area: 'data',
            summary: `Profiles have no recorded response for ${line.missingResponses.length} requests (${line.noDataCells}/${line.cells} cells without data).`,
            items: line.missingResponses,
            command:
                'camera-re-capture skill, then bun run compat:ingest -- --capture <profile-id>=<file.pcapng> --simulate',
        })
    }
    if (line.unverifiedQuirks.length) {
        actions.push({
            kind: 'verify-quirks',
            area: 'data',
            summary: `Confirm ${line.unverifiedQuirks.length} quirks their sources mark unconfirmed.`,
            items: line.unverifiedQuirks,
            command: 'camera-re-verify skill',
        })
    }
    if (line.unverifiedModels.length) {
        actions.push({
            kind: 'verify-catalog',
            area: 'data',
            summary: `${line.unverifiedModels.length} catalog models are unconfirmed by their sources.`,
            items: line.unverifiedModels,
        })
    }
    if (line.ptpIp && line.ptpIp !== 'simulated') {
        actions.push({ kind: 'configure-ptp-ip', area: 'data', summary: `Not simulated over PTP/IP: ${line.ptpIp}` })
    }
    return actions
}
