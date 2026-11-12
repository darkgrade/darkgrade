import { operatorAuthorized } from '#collector/investigate'
import type { EventFilters } from '#collector/operator-queries'
import type { postgresDatabase } from '#collector/postgres'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { withdrawInstallation } from '#collector/telemetry'

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers })
async function body(request: Request) {
    if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new Error('Invalid body')
    const reader = request.body?.getReader()
    if (!reader) throw new Error('Missing body')
    let size = 0
    const chunks: Uint8Array[] = []
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            size += next.value.length
            if (size > 4096) throw new Error('Body too large')
            chunks.push(next.value)
        }
    } finally {
        await reader.cancel().catch(() => {})
    }
    const value = JSON.parse(Buffer.concat(chunks).toString())
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid body')
    return value as Record<string, unknown>
}

/** Server-to-server operator API. No credentials/contact details or arbitrary SQL are exposed. */
export async function operatorApi(
    request: Request,
    key: string | undefined,
    database: Awaited<ReturnType<typeof postgresDatabase>>
) {
    if (!key || key.length < 32) return json({ error: 'Not configured' }, 404)
    if (!operatorAuthorized(request, key)) return json({ error: 'Operator authorization required' }, 401)
    const url = new URL(request.url),
        path = url.pathname
    const parameters = Object.fromEntries(url.searchParams)
    if (
        new Set(url.searchParams.keys()).size !== [...url.searchParams].length ||
        Object.values(parameters).some(value => value.length > (path === '/internal/api/session' ? 600 : 100))
    )
        return json({ error: 'Invalid filters' }, 400)
    if (
        request.method !== 'GET' &&
        (request.headers.has('origin') || request.headers.get('x-darkgrade-operator') !== '1')
    )
        return json({ error: 'Server operator request required' }, 403)
    if (path === '/internal/api/report' && request.method === 'GET') {
        if (
            Object.keys(parameters).some(
                key => !['days', 'installation', 'model', 'session', 'revision', 'transport'].includes(key)
            ) ||
            ![1, 7, 30, 90].includes(Number(parameters.days || 7)) ||
            ['installation', 'session'].some(key => parameters[key] && !uuid.test(parameters[key]))
        )
            return json({ error: 'Invalid filters' }, 400)
        return json(
            await database.operator.report({ ...parameters, days: Number(parameters.days || 7) } as EventFilters)
        )
    }
    if (path === '/internal/api/session' && request.method === 'GET') {
        if (
            Object.keys(parameters).some(key => !['installation', 'session', 'after'].includes(key)) ||
            !uuid.test(parameters.installation || '') ||
            !uuid.test(parameters.session || '')
        )
            return json({ error: 'Invalid session scope' }, 400)
        let after: { time: string; batch: string; sequence: number } | undefined
        if (parameters.after) {
            try {
                if (!/^[A-Za-z0-9_-]+$/.test(parameters.after)) throw new Error('Invalid cursor')
                const value = JSON.parse(Buffer.from(parameters.after, 'base64url').toString())
                if (
                    !value ||
                    Object.keys(value).sort().join(',') !== 'batch,sequence,time' ||
                    typeof value.time !== 'string' ||
                    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(value.time) ||
                    !Number.isFinite(Date.parse(value.time)) ||
                    typeof value.batch !== 'string' ||
                    !value.batch.startsWith('diagnostics/') ||
                    value.batch.slice(12).split('_').length !== 2 ||
                    !value.batch
                        .slice(12)
                        .split('_')
                        .every((part: string) => uuid.test(part)) ||
                    !Number.isInteger(value.sequence) ||
                    value.sequence < 0 ||
                    value.sequence > 1000
                )
                    throw new Error('Invalid cursor')
                after = value
            } catch {
                return json({ error: 'Invalid session cursor' }, 400)
            }
        }
        return json(await database.operator.session(parameters.installation, parameters.session, after))
    }
    if (path === '/internal/api/installations' && request.method === 'GET') {
        if (
            Object.keys(parameters).some(key => !['after', 'installation'].includes(key)) ||
            Object.values(parameters).some(value => value && !uuid.test(value))
        )
            return json({ error: 'Invalid installation filter' }, 400)
        return json(await database.operator.installations(parameters.after, parameters.installation))
    }
    if (Object.keys(parameters).length) return json({ error: 'Unexpected query' }, 400)
    if (path === '/internal/api/matrix' && request.method === 'GET') return json(await exportReviewedPatterns(database))
    if (path === '/internal/api/review' && request.method === 'POST') {
        let value: Record<string, unknown>
        try {
            value = await body(request)
        } catch {
            return json({ error: 'Invalid review request' }, 400)
        }
        if (
            Object.keys(value).length !== 1 ||
            typeof value.sourceRecord !== 'string' ||
            value.sourceRecord.split('_').length !== 2 ||
            !value.sourceRecord.split('_').every(part => uuid.test(part))
        )
            return json({ error: 'Invalid source record' }, 400)
        try {
            await reviewDiagnostic(database, value.sourceRecord)
            return json({ reviewed: true })
        } catch {
            return json({ error: 'Source unavailable, expired or withdrawn' }, 409)
        }
    }
    const match = /^\/internal\/api\/installations\/([^/]+)$/.exec(path)
    if (match && request.method === 'DELETE') {
        let value: Record<string, unknown>
        try {
            value = await body(request)
        } catch {
            return json({ error: 'Invalid deletion request' }, 400)
        }
        if (!uuid.test(match[1]) || Object.keys(value).length !== 1 || value.confirm !== match[1])
            return json({ error: 'Confirm the installation ID' }, 400)
        if (!(await database.get(`installations/${match[1]}`))) return json({ error: 'Installation not found' }, 404)
        const result = await withdrawInstallation(database, match[1])
        return json(result, result.deletionPending ? 202 : 200)
    }
    return json({ error: 'Not found' }, 404)
}
