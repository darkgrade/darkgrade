/**
 * Where the MCP server gets its answers: the HTTP API of a running `compat:ui` (so it sees the same
 * live state, and a run it starts shows in the open UI), or the data layer directly when no UI is
 * running. Both expose the same calls.
 */
import type { CameraList, CameraQuery, CompatApi, GapSummary, IngestRequest, RunStatus } from './compat-api'
import { queryString } from './compat-api'
import type { CameraDetailModel } from './compat-pages'
import type { RunSummary, ViewRow } from './compat-view'

export interface GapFilter {
    manufacturer?: string
    line?: string
    kind?: string
    area?: string
    all?: boolean
}

export interface CompatBackend {
    readonly mode: 'http' | 'local'
    /** The UI's address when there is one, for links in answers. */
    readonly uiUrl?: string
    listCameras(query: CameraQuery): Promise<CameraList>
    camera(profile: string): Promise<{ camera: CameraDetailModel; rows: ViewRow[] }>
    status(): Promise<RunStatus>
    runs(limit?: number): Promise<RunSummary[]>
    gaps(filter: GapFilter): Promise<GapSummary>
    gapsMarkdown(): Promise<string>
    catalog(): Promise<unknown>
    startRun(request: { filter?: string; filters?: CameraQuery }): Promise<unknown>
    cancelRun(): Promise<unknown>
    ingest(request: IngestRequest): Promise<unknown>
    regenerate(request: { targets?: string[] }): Promise<unknown>
}

/** The data layer in this process; runs it starts are children of this process. */
export function localBackend(api: CompatApi): CompatBackend {
    return {
        mode: 'local',
        listCameras: async query => api.listCameras(query),
        camera: async profile => api.camera(profile),
        status: async () => api.status(),
        runs: async limit => api.runs(limit),
        gaps: async filter => api.gaps(filter),
        gapsMarkdown: async () => api.gapsMarkdown(),
        catalog: async () => api.catalog(),
        startRun: async request => api.startRun(request),
        cancelRun: async () => api.cancelRun(),
        ingest: request => api.ingest(request),
        regenerate: request => api.regenerate(request),
    }
}

export class HttpBackendError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message)
    }
}

/** A running `compat:ui` server's API, e.g. http://127.0.0.1:4174/. */
export function httpBackend(uiUrl: string, options: { token?: string; fetch?: typeof fetch } = {}): CompatBackend {
    const base = uiUrl.endsWith('/') ? uiUrl : `${uiUrl}/`
    const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
        const response = await (options.fetch ?? fetch)(`${base}api/v1/${path}`, {
            method,
            headers: {
                ...(body !== undefined && { 'content-type': 'application/json' }),
                ...(options.token && { authorization: `Bearer ${options.token}` }),
            },
            ...(body !== undefined && { body: JSON.stringify(body) }),
        })
        const text = await response.text()
        let value: unknown = text
        if ((response.headers.get('content-type') ?? '').includes('json')) {
            try {
                value = JSON.parse(text)
            } catch {
                throw new HttpBackendError(response.status, `${path} returned malformed JSON`)
            }
        }
        if (!response.ok) {
            const message =
                typeof value === 'object' && value && 'message' in value
                    ? String(value.message)
                    : `HTTP ${response.status}`
            throw new HttpBackendError(response.status, message)
        }
        return value
    }
    const get = <T>(path: string) => request('GET', path) as Promise<T>
    const gapQuery = (filter: GapFilter) =>
        new URLSearchParams(
            Object.entries(filter).flatMap(([key, value]) =>
                value === undefined || value === false ? [] : [[key, String(value)]]
            )
        ).toString()
    return {
        mode: 'http',
        uiUrl: base,
        listCameras: query => get(`cameras?${queryString(query)}`),
        camera: profile => get(`cameras/${encodeURIComponent(profile)}`),
        status: () => get('status'),
        runs: limit => get(`runs${limit ? `?limit=${limit}` : ''}`),
        gaps: filter => get(`gaps?${gapQuery(filter)}`),
        gapsMarkdown: () => get('gaps.md'),
        catalog: () => get('catalog'),
        startRun: body => request('POST', 'runs', body),
        cancelRun: () => request('DELETE', 'runs/active'),
        ingest: body => request('POST', 'ingest', body),
        regenerate: body => request('POST', 'reports', body),
    }
}

/** Whether a compatibility UI answers at this address (within a short timeout). */
export async function probeUi(uiUrl: string, timeoutMilliseconds = 800): Promise<boolean> {
    try {
        const base = uiUrl.endsWith('/') ? uiUrl : `${uiUrl}/`
        const response = await fetch(`${base}api/v1`, { signal: AbortSignal.timeout(timeoutMilliseconds) })
        return response.ok
    } catch {
        return false
    }
}
