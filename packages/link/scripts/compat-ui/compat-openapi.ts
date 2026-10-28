/** The compatibility API's OpenAPI description, served at /api/v1/openapi.json. */

const filterParameters = [
    ['manufacturer', 'Manufacturer slug, e.g. canon'],
    ['line', 'Line slug, e.g. eos-r'],
    ['fidelity', 'Comma-separated: hardware, captured, documented'],
    ['transport', 'Comma-separated: usb, ptp-ip'],
    ['kind', 'Comma-separated: model, line, profile'],
    ['unverified', 'yes or no'],
    ['profile', 'Comma-separated exact profile ids'],
    ['q', 'Free text over model, profile and VID:PID'],
    ['sort', 'model, manufacturer, line, fidelity, transport, unverified, last-run, or a capability id'],
    ['order', 'asc or desc'],
    ['run', 'Show one run log id or matrix ("matrix:<file>") instead of the latest results'],
    ['limit', 'Page size (default 100, at most 5000)'],
    ['offset', 'Rows to skip'],
].map(([name, description]) => ({ name, in: 'query', required: false, description, schema: { type: 'string' } }))

const json = (description: string, schema: object = { type: 'object' }) => ({
    description,
    content: { 'application/json': { schema } },
})

const errors = {
    '400': json('Bad request', { $ref: '#/components/schemas/Error' }),
    '401': json('Missing or wrong token (only when COMPAT_API_TOKEN is set)', { $ref: '#/components/schemas/Error' }),
    '403': json('Control endpoints only answer loopback callers', { $ref: '#/components/schemas/Error' }),
}

export const openApiDocument = {
    openapi: '3.1.0',
    info: {
        title: 'darkgrade camera compatibility API',
        version: '1.0.0',
        description:
            'Served by `bun run compat:ui` on http://127.0.0.1:4174/api/v1. Read endpoints are open to whoever can reach the server (loopback by default). Control endpoints (POST/DELETE) answer loopback callers only, need `content-type: application/json`, reject cross-origin requests, and need `Authorization: Bearer <token>` when COMPAT_API_TOKEN is set.',
    },
    servers: [{ url: 'http://127.0.0.1:4174/api/v1' }],
    paths: {
        '/cameras': {
            get: {
                summary:
                    'Rows (one per profile, tier and link) matching the UI filters; any capability id is also a status filter, e.g. set-property=fail',
                parameters: filterParameters,
                responses: { '200': json('A page of rows', { $ref: '#/components/schemas/CameraList' }) },
            },
        },
        '/cameras/{profile}': {
            get: {
                summary:
                    'One camera profile: identity, USB ids, results per tier and link, quirks with citations, exchanges, sources, run history',
                parameters: [
                    { name: 'profile', in: 'path', required: true, schema: { type: 'string' } },
                    filterParameters.find(parameter => parameter.name === 'run'),
                ],
                responses: { '200': json('The camera'), '404': json('No such profile') },
            },
        },
        '/view': {
            get: {
                summary: 'The whole view model the UI renders (rows, capabilities, sources, active run, runs)',
                parameters: [filterParameters.find(parameter => parameter.name === 'run')],
                responses: { '200': json('The view') },
            },
        },
        '/status': {
            get: {
                summary: 'The run in progress, the run this server started and the latest runs',
                responses: { '200': json('Run status') },
            },
        },
        '/runs': {
            get: { summary: 'Run summaries, newest first', responses: { '200': json('Runs', { type: 'array' }) } },
            post: {
                summary: 'Start a simulation run for a filter (empty = everything)',
                requestBody: {
                    required: false,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    filter: { type: 'string', example: 'manufacturer=sony&transport=ptp-ip' },
                                    filters: { type: 'object', description: 'The same filter as structured fields' },
                                },
                            },
                        },
                    },
                },
                responses: { '202': json('Started'), '409': json('A run is already in progress'), ...errors },
            },
        },
        '/runs/active': {
            delete: {
                summary: 'Cancel the run this server started',
                responses: { '200': json('Cancelling'), '409': json('Nothing to cancel'), ...errors },
            },
        },
        '/runs/{runId}': {
            get: {
                summary: 'One run log on its own: summary and the rows it touched',
                parameters: [{ name: 'runId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: { '200': json('The run'), '404': json('No such run') },
            },
        },
        '/gaps': {
            get: {
                summary: 'What needs changing or configuring, per manufacturer and line, with next actions',
                parameters: ['manufacturer', 'line', 'kind', 'area', 'all'].map(name => ({
                    name,
                    in: 'query',
                    required: false,
                    schema: { type: 'string' },
                })),
                responses: { '200': json('Gaps grouped by manufacturer and line') },
            },
        },
        '/gaps.md': {
            get: {
                summary: 'The gaps report as Markdown (GAPS.md)',
                responses: { '200': { description: 'Markdown' } },
            },
        },
        '/catalog': {
            get: {
                summary: 'Manufacturers, lines, capabilities, statuses and profile counts',
                responses: { '200': json('The catalog') },
            },
        },
        '/profiles': {
            get: {
                summary: 'Simulator profiles (captured, documented line and per-model mocks)',
                parameters: ['manufacturer', 'fidelity', 'q', 'limit', 'offset'].map(name => ({
                    name,
                    in: 'query',
                    required: false,
                    schema: { type: 'string' },
                })),
                responses: { '200': json('Profiles') },
            },
        },
        '/ingest': {
            post: {
                summary:
                    'Ingest usbmon captures into profiles and/or hardware result files (paths on the server machine)',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    captures: {
                                        type: 'array',
                                        items: {
                                            type: 'object',
                                            required: ['profile', 'file'],
                                            properties: {
                                                profile: { type: 'string' },
                                                file: { type: 'string' },
                                                bus: { type: 'integer' },
                                                address: { type: 'integer' },
                                            },
                                        },
                                    },
                                    results: { type: 'array', items: { type: 'string' } },
                                    simulate: { type: 'boolean' },
                                    merge: { type: 'boolean' },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': json('What was written'),
                    '422': json('The file could not be ingested'),
                    ...errors,
                },
            },
        },
        '/import': {
            post: {
                summary: 'Upload a run log (*.jsonl) or support matrix (*.json) to view; ?name=<file name>',
                responses: { '200': json('Loaded'), ...errors },
            },
        },
        '/reports': {
            post: {
                summary: 'Regenerate reports: merge (merged matrix), readme (README section), gaps (GAPS.md)',
                requestBody: {
                    required: false,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    targets: { type: 'array', items: { enum: ['merge', 'readme', 'gaps'] } },
                                },
                            },
                        },
                    },
                },
                responses: { '200': json('Files written'), '409': json('Missing input matrix'), ...errors },
            },
        },
        '/events': {
            get: {
                summary: 'Server-sent events: progress (RunSummary or null), rows (changed rows), reload',
                responses: { '200': { description: 'text/event-stream' } },
            },
        },
    },
    components: {
        schemas: {
            Error: { type: 'object', properties: { message: { type: 'string' } } },
            CameraList: {
                type: 'object',
                properties: {
                    total: { type: 'integer' },
                    offset: { type: 'integer' },
                    limit: { type: 'integer' },
                    filter: { type: 'string' },
                    capabilities: { type: 'array' },
                    rows: { type: 'array' },
                },
            },
        },
    },
}
