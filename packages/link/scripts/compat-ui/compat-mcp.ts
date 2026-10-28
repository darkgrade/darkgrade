/**
 * An MCP server for camera compatibility, so an agent can poll what needs changing or configuring
 * and act on it: list and inspect cameras, follow runs, list gaps with next actions, start or cancel
 * simulation runs, ingest captures and results, and regenerate reports. It answers from a running
 * `compat:ui` (HTTP API) or from the data layer directly; see compat-backend.ts.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { CameraQuery } from './compat-api'
import type { CompatBackend } from './compat-backend'
import { openApiDocument } from './compat-openapi'
import type { ViewRow } from './compat-view'

const FIDELITY = z.enum(['hardware', 'captured', 'documented'])
const TRANSPORT = z.enum(['usb', 'ptp-ip'])
const KIND = z.enum(['model', 'line', 'profile'])
const STATUS = z.enum(['pass', 'fail', 'unsupported', 'no-data', 'running', 'queued', 'unknown'])

const filterShape = {
    manufacturer: z.string().max(80).optional().describe('Manufacturer slug, e.g. "canon" or "sony"'),
    line: z.string().max(120).optional().describe('Line slug within the manufacturer, e.g. "eos-r"'),
    fidelity: z.array(FIDELITY).optional().describe('Evidence tiers to keep'),
    transport: z.array(TRANSPORT).optional().describe('Links to keep'),
    kind: z.array(KIND).optional().describe('"model" and "line" mocks, or "profile" (captured and hardware rows)'),
    unverified: z
        .enum(['yes', 'no'])
        .optional()
        .describe('Only rows with (or without) unverified quirks or catalog entries'),
    status: z
        .record(z.string(), z.array(STATUS))
        .optional()
        .describe('Capability id -> statuses to keep, e.g. {"set-property": ["fail"]}'),
    q: z.string().max(200).optional().describe('Free text over model, profile id and VID:PID'),
    profile: z.array(z.string().max(200)).optional().describe('Exact profile ids'),
}

/** A row reduced to what an agent needs to decide what to look at next. */
function compactRow(row: ViewRow) {
    return {
        profile: row.profile,
        key: row.key,
        model: row.model,
        manufacturer: row.manufacturer,
        line: row.line,
        fidelity: row.fidelity,
        ...(row.scope && { scope: row.scope }),
        transport: row.transport,
        unverified: row.unverified,
        statuses: Object.fromEntries(
            Object.entries(row.cells ?? {}).map(([capability, cell]) => [capability, cell.status])
        ),
        ...(row.lastRun && { lastRun: row.lastRun }),
        ...(row.state !== 'idle' && { state: row.state }),
    }
}

function answer(value: unknown) {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return { content: [{ type: 'text' as const, text }] }
}

function failure(error: unknown) {
    return {
        isError: true,
        content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    }
}

/** Runs a tool body and turns a thrown error into an MCP tool error the agent can read. */
async function attempt(work: () => Promise<unknown>) {
    try {
        return answer(await work())
    } catch (error) {
        return failure(error)
    }
}

export function createCompatMcpServer(backend: CompatBackend): McpServer {
    const server = new McpServer(
        { name: 'darkgrade-compat', version: '1.0.0' },
        {
            instructions:
                'Camera compatibility for darkgrade (@darkgrade/link). Start with list_gaps to see what needs changing or configuring, ' +
                'list_cameras to find rows by result (e.g. status {"set-property":["fail"]}), get_camera for one profile, and ' +
                'get_run_status to follow a run. start_run runs the simulation suite for a filter; ingest takes usbmon captures and ' +
                'hardware result files; regenerate_reports rebuilds the merged matrix, README section and GAPS.md.',
        }
    )

    server.registerTool(
        'list_cameras',
        {
            title: 'List cameras',
            description:
                'Rows (one per camera profile, evidence tier and link) with a status per capability, filtered like the UI. Returns the total, the filter as a query string, and compact rows.',
            inputSchema: {
                ...filterShape,
                sort: z
                    .string()
                    .max(80)
                    .optional()
                    .describe(
                        'model, manufacturer, line, fidelity, transport, unverified, last-run, or a capability id'
                    ),
                order: z.enum(['asc', 'desc']).optional(),
                limit: z.number().int().min(1).max(500).optional().describe('Rows to return (default 50)'),
                offset: z.number().int().min(0).optional(),
            },
            annotations: { readOnlyHint: true },
        },
        arguments_ =>
            attempt(async () => {
                const list = await backend.listCameras({
                    ...(arguments_ as CameraQuery),
                    limit: arguments_.limit ?? 50,
                })
                return {
                    total: list.total,
                    offset: list.offset,
                    returned: list.rows.length,
                    filter: list.filter,
                    ...(backend.uiUrl && { uiUrl: `${backend.uiUrl}${list.filter ? `?${list.filter}` : ''}` }),
                    capabilities: list.capabilities.map(capability => capability.id),
                    rows: list.rows.map(compactRow),
                }
            })
    )

    server.registerTool(
        'get_camera',
        {
            title: 'Get camera',
            description:
                'Everything about one profile: identity, USB ids, every result per tier and link with its message, quirks with citations, recorded exchanges, sources and run history.',
            inputSchema: { profile: z.string().min(1).max(200).describe('Profile id, e.g. "canon-eos-r6-mark-iii"') },
            annotations: { readOnlyHint: true },
        },
        ({ profile }) =>
            attempt(async () => {
                const { camera } = await backend.camera(profile)
                return {
                    ...camera,
                    ...(backend.uiUrl && { uiUrl: `${backend.uiUrl}?camera=${encodeURIComponent(profile)}` }),
                }
            })
    )

    server.registerTool(
        'get_run_status',
        {
            title: 'Get run status',
            description:
                'The run in progress (rows, checks, counts, the capability in flight), the run this server started, and the latest runs.',
            inputSchema: {},
            annotations: { readOnlyHint: true },
        },
        () => attempt(() => backend.status())
    )

    server.registerTool(
        'list_runs',
        {
            title: 'List runs',
            description: 'Run summaries, newest first.',
            inputSchema: { limit: z.number().int().min(1).max(200).optional() },
            annotations: { readOnlyHint: true },
        },
        ({ limit }) => attempt(() => backend.runs(limit ?? 20))
    )

    server.registerTool(
        'list_gaps',
        {
            title: 'List gaps',
            description:
                'What needs changing or configuring, grouped by manufacturer and line, each with next actions (kind, library or data, summary, items, and the command or skill that closes it).',
            inputSchema: {
                manufacturer: z.string().max(80).optional(),
                line: z.string().max(120).optional(),
                kind: z
                    .enum([
                        'add-vendor-definitions',
                        'define-operations',
                        'extend-definitions',
                        'define-events',
                        'find-usb-ids',
                        'add-line-mock',
                        'run-hardware',
                        'capture-responses',
                        'verify-quirks',
                        'verify-catalog',
                        'configure-ptp-ip',
                    ])
                    .optional(),
                area: z.enum(['library', 'data']).optional(),
                all: z.boolean().optional().describe('Include lines with nothing to do'),
            },
            annotations: { readOnlyHint: true },
        },
        filter => attempt(() => backend.gaps(filter))
    )

    server.registerTool(
        'start_run',
        {
            title: 'Start simulation run',
            description:
                'Runs the simulation suite for the rows a filter selects (everything when empty). Follow it with get_run_status. Only one run at a time.',
            inputSchema: {
                filter: z
                    .string()
                    .max(2000)
                    .optional()
                    .describe('A UI query string, e.g. "manufacturer=sony&transport=ptp-ip"'),
                filters: z.object(filterShape).optional().describe('The same filter as fields; used instead of filter'),
            },
        },
        ({ filter, filters }) =>
            attempt(() =>
                backend.startRun({
                    ...(filter !== undefined && { filter }),
                    ...(filters && { filters: filters as CameraQuery }),
                })
            )
    )

    server.registerTool(
        'cancel_run',
        {
            title: 'Cancel run',
            description: 'Cancels the simulation run this server (or the UI it talks to) started.',
            inputSchema: {},
            annotations: { destructiveHint: true },
        },
        () => attempt(() => backend.cancelRun())
    )

    server.registerTool(
        'ingest',
        {
            title: 'Ingest captures and results',
            description:
                'Takes usbmon captures into camera profiles (a per-model mock id starts a new captured profile) and/or hardware result files (run log *.jsonl or matrix *.json). Paths are on the machine running the server.',
            inputSchema: {
                captures: z
                    .array(
                        z.object({
                            profile: z.string().regex(/^[a-z0-9-]+$/),
                            file: z.string().min(1),
                            bus: z.number().int().optional(),
                            address: z.number().int().optional(),
                        })
                    )
                    .optional(),
                results: z.array(z.string().min(1)).optional(),
                simulate: z.boolean().optional().describe('Re-run the suite for the captured profiles afterwards'),
                merge: z.boolean().optional().describe('Rebuild the hardware and merged matrices afterwards'),
            },
        },
        request => attempt(() => backend.ingest(request))
    )

    server.registerTool(
        'regenerate_reports',
        {
            title: 'Regenerate reports',
            description:
                'Rebuilds the merged matrix ("merge"), the README compatibility section ("readme") and GAPS.md ("gaps"); all three by default.',
            inputSchema: { targets: z.array(z.enum(['merge', 'readme', 'gaps'])).optional() },
        },
        ({ targets }) => attempt(() => backend.regenerate({ ...(targets && { targets }) }))
    )

    server.registerResource(
        'matrix',
        'compat://matrix',
        {
            title: 'Compatibility matrix',
            description: 'Every row with its status per capability',
            mimeType: 'application/json',
        },
        async uri => {
            const list = await backend.listCameras({ limit: 5_000 })
            const value = { total: list.total, capabilities: list.capabilities, rows: list.rows.map(compactRow) }
            return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value) }] }
        }
    )

    server.registerResource(
        'gaps',
        'compat://gaps',
        {
            title: 'Compatibility gaps',
            description: 'GAPS.md: library and data gaps per line',
            mimeType: 'text/markdown',
        },
        async uri => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: await backend.gapsMarkdown() }] })
    )

    server.registerResource(
        'openapi',
        'compat://openapi',
        {
            title: 'HTTP API',
            description: 'OpenAPI description of the compat:ui HTTP API',
            mimeType: 'application/json',
        },
        async uri => ({
            contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(openApiDocument) }],
        })
    )

    return server
}
