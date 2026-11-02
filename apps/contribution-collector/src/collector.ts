import { verifyGrant } from '#collector/token'
import { MAXIMUM_BODY_BYTES, validateContribution } from '@darkgrade/contribute/schema'
import { createHash } from 'node:crypto'

export interface ContributionStore {
    /** Durable, per-contributor UTC-day quota. Retries of the same body do not consume another slot. */
    admit(contributor: string, digest: string): Promise<boolean>
    revoked(contributor: string): Promise<boolean>
    revoke(contributor: string): Promise<void>
    /** Atomic create; return false if this immutable key already exists. */
    create(key: string, body: string): Promise<boolean>
    remove(key: string): Promise<void>
    removeContributions(contributor: string): Promise<void>
}
const response = (status: number, error?: string) =>
    Response.json(error ? { error } : { ok: true }, {
        status,
        headers: { 'cache-control': 'no-store' },
    })
const hash = (body: string) => createHash('sha256').update(body).digest('hex')

async function boundedBody(request: Request) {
    if (!request.body) throw new Error('Missing body')
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
        while (true) {
            const next = await reader.read()
            if (next.done) break
            size += next.value.length
            if (size > MAXIMUM_BODY_BYTES) throw new Error('Too large')
            chunks.push(next.value)
        }
    } finally {
        await reader.cancel().catch(() => {})
        reader.releaseLock()
    }
    return Buffer.concat(chunks).toString('utf8')
}

/** Data remains private and unreviewed. This endpoint never promotes an upload into Matrix. */
export function createCollector(store: ContributionStore, signingKey: string) {
    if (Buffer.byteLength(signingKey) < 32) throw new Error('Missing collector signing key')
    return async (request: Request): Promise<Response> => {
        const url = new URL(request.url)
        if (url.pathname === '/healthz' && request.method === 'GET') return response(200)
        if (url.pathname !== '/v1/contributions' || url.search) return response(404, 'Not found')
        if (!['POST', 'DELETE'].includes(request.method)) return response(405, 'Method not allowed')
        let grant
        try {
            const authorization = request.headers.get('authorization') ?? ''
            if (!authorization.startsWith('Bearer ')) return response(401, 'Authentication required')
            grant = verifyGrant(authorization.slice(7), signingKey, request.method === 'DELETE')
        } catch {
            return response(401, 'Invalid contribution token')
        }
        const contributor = grant.contributorId
        try {
            if (request.method === 'DELETE') {
                // Tombstone first. Never expire it with the contribution objects.
                await store.revoke(contributor)
                await store.removeContributions(contributor)
                return response(200)
            }
            if (await store.revoked(contributor)) return response(410, 'Contribution consent withdrawn')
            if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json')
                return response(415, 'JSON required')
            let contribution
            try {
                contribution = JSON.parse(await boundedBody(request))
                validateContribution(contribution)
            } catch {
                return response(400, 'Invalid or oversized diagnostics')
            }
            const digest = hash(JSON.stringify(contribution))
            if (!(await store.admit(contributor, digest)))
                return new Response(JSON.stringify({ error: 'Daily contribution limit reached' }), {
                    status: 429,
                    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': '3600' },
                })
            const key = `contributions/${contributor}/${contribution.id}-${digest}.json`
            const stored = {
                schema: 'darkgrade.contribution-record/v1',
                review: 'unreviewed',
                receivedAt: new Date().toISOString(),
                provenance: {
                    contributorId: contributor,
                    termsVersion: grant.termsVersion,
                    credit: grant.credit ?? null,
                    source: '@darkgrade/contribute',
                    sha256: digest,
                },
                contribution,
            }
            await store.create(key, JSON.stringify(stored))
            // GCS is strongly consistent. If withdrawal raced with the write, remove the late object.
            if (await store.revoked(contributor)) {
                await store.remove(key)
                return response(410, 'Contribution consent withdrawn')
            }
            return response(202)
        } catch {
            return response(503, 'Contribution storage unavailable; retry later')
        }
    }
}
