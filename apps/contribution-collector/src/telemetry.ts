import type { Database, Transaction } from '#collector/database'
import { changeMatrixGeneration } from '#collector/matrix-generation'
import { BATCH_SCHEMA, DIAGNOSTICS_NOTICE, NOTICE_VERSION, validateBatch } from '@darkgrade/contribute/batch'
import { MAXIMUM_BODY_BYTES } from '@darkgrade/contribute/schema'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

export const RETENTION_DAYS = 90
export const DAILY_BATCH_LIMIT = 4096
const DAY = 86_400_000
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const dateKey = (date: Date) => date.toISOString().slice(0, 10)
export class TelemetryError extends Error {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message)
    }
}
const fail = (status: number, message: string): never => {
    throw new TelemetryError(status, message)
}
const exact = (body: any, keys: string[]) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !keys.includes(key)))
        fail(400, 'Invalid request')
}
const tokenPattern = /^dgi_([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/
const credentialHash = (secret: string) => digest(secret)
async function authenticate(database: Database, authorization: string) {
    const match = tokenPattern.exec(authorization.replace(/^Bearer /, ''))
    if (!authorization.startsWith('Bearer ') || !match) fail(401, 'Install key required')
    const installId = match![1]
    const install = await database.get(`installations/${installId}`)
    const hash = credentialHash(match![2])
    if (
        !install ||
        typeof install.keyHash !== 'string' ||
        install.keyHash.length !== hash.length ||
        !timingSafeEqual(Buffer.from(hash), Buffer.from(install.keyHash))
    )
        fail(401, 'Invalid install key')
    return { installId, keyHash: hash }
}
async function active(transaction: Transaction, installId: string, keyHash?: string) {
    const install = await transaction.get(`installations/${installId}`)
    if (!install || (keyHash && install.keyHash !== keyHash)) fail(401, 'Invalid install key')
    if (install!.revoked) fail(410, 'Installation withdrawn')
    return install!
}
export interface ContactMessage {
    email: string
    confirmationUrl: string
    idempotencyKey: string
}
export interface TelemetryOptions {
    publicUrl: string
    allowedOrigins?: string[]
    sendContact?: (message: ContactMessage) => Promise<void>
    now?: () => Date
    /** Bounds anonymous enrollment cost across instances; this is not per-person identity verification. */
    dailyEnrollmentLimit?: number
}

async function readJson(request: Request) {
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') fail(415, 'JSON required')
    if (Number(request.headers.get('content-length')) > MAXIMUM_BODY_BYTES) fail(413, 'Request too large')
    const reader = request.body?.getReader()
    if (!reader) fail(400, 'Missing request body')
    let length = 0
    const chunks: Uint8Array[] = []
    try {
        for (;;) {
            const item = await reader!.read()
            if (item.done) break
            length += item.value.length
            if (length > MAXIMUM_BODY_BYTES) fail(413, 'Request too large')
            chunks.push(item.value)
        }
        try {
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
        } catch {
            return fail(400, 'Invalid JSON')
        }
    } finally {
        await reader!.cancel().catch(() => {})
        reader!.releaseLock()
    }
}

/** A single service stores diagnostics and consent state in Postgres. No bearer keys enter records. */
export function createTelemetry(database: Database, options: TelemetryOptions) {
    const publicUrl = new URL(options.publicUrl)
    if (
        publicUrl.protocol !== 'https:' ||
        publicUrl.username ||
        publicUrl.password ||
        publicUrl.search ||
        publicUrl.hash ||
        publicUrl.pathname !== '/'
    )
        throw new Error('A public HTTPS origin is required')
    const enrollmentLimit = options.dailyEnrollmentLimit ?? 1000
    if (!Number.isSafeInteger(enrollmentLimit) || enrollmentLimit < 1) throw new Error('Invalid enrollment limit')
    const now = options.now ?? (() => new Date())
    const origins = new Set(options.allowedOrigins ?? [])
    for (const origin of origins) {
        const parsed = new URL(origin)
        if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol))
            throw new Error('Invalid allowed origin')
    }
    const route = async (request: Request): Promise<Response> => {
        const url = new URL(request.url)
        if (url.search) return Response.json({ error: 'Query parameters are not accepted' }, { status: 400 })
        const method = request.method,
            path = url.pathname
        if (path === '/healthz' && method === 'GET') return Response.json({ ok: true })
        if (path === '/v2/notice' && method === 'GET')
            return Response.json({ version: NOTICE_VERSION, text: DIAGNOSTICS_NOTICE, retentionDays: RETENTION_DAYS })
        if (path === '/confirm' && method === 'GET') return confirmationPage()
        if (path === '/v2/installations' && method === 'POST') {
            const body = await readJson(request)
            exact(body, ['noticeVersion', 'installKey'])
            if (body.noticeVersion !== NOTICE_VERSION) fail(422, 'Unsupported telemetry protocol version')
            const supplied = body.installKey === undefined ? undefined : tokenPattern.exec(String(body.installKey))
            if (body.installKey !== undefined && !supplied) fail(400, 'Invalid installation credential')
            const installId = supplied?.[1] ?? randomUUID(),
                secret = supplied?.[2] ?? randomBytes(32).toString('base64url'),
                date = now()
            await database.transaction(async transaction => {
                const previous = await transaction.get(`installations/${installId}`)
                if (previous) {
                    if (previous.keyHash !== credentialHash(secret)) fail(409, 'Installation identity already exists')
                    if (previous.revoked) fail(410, 'Installation withdrawn')
                    return
                }
                const quotaPath = `enrollmentQuotas/${dateKey(date)}`
                const quota = await transaction.get(quotaPath)
                if ((quota?.count ?? 0) >= enrollmentLimit) fail(429, 'Enrollment limit reached; retry tomorrow')
                transaction.set(quotaPath, { count: (quota?.count ?? 0) + 1, expiresAt: new Date(+date + 2 * DAY) })
                transaction.set(`installations/${installId}`, {
                    keyHash: credentialHash(secret),
                    noticeVersion: NOTICE_VERSION,
                    createdAt: date,
                    revoked: false,
                    pendingDeletion: false,
                    emailGeneration: 0,
                })
            })
            return Response.json(
                { installId, installKey: `dgi_${installId}.${secret}`, noticeVersion: NOTICE_VERSION },
                { status: 201 }
            )
        }
        if (path === '/v2/contact/confirm' && method === 'POST') {
            const body = await readJson(request)
            exact(body, ['token'])
            if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(body.token))
                fail(400, 'Invalid confirmation')
            const challengePath = `contactChallenges/${digest(body.token)}`
            await database.transaction(async transaction => {
                const challenge = await transaction.get(challengePath)
                if (!challenge || !(challenge.expiresAt instanceof Date) || +challenge.expiresAt <= +now())
                    fail(410, 'Confirmation expired or already used')
                const install = await active(transaction, challenge!.installId)
                if (install.emailGeneration !== challenge!.generation) fail(410, 'Confirmation replaced')
                transaction.set(`contacts/${challenge!.installId}`, {
                    installId: challenge!.installId,
                    email: challenge!.email,
                    groupId: digest(challenge!.email),
                    confirmedAt: now(),
                    credit: challenge!.credit,
                })
                transaction.delete(challengePath)
                changeMatrixGeneration(transaction)
            })
            return Response.json({ confirmed: true })
        }
        const routes = new Set(['/v2/installation', '/v2/batches', '/v2/contact'])
        if (!routes.has(path)) fail(404, 'Not found')
        if (path === '/v2/installation' && method === 'DELETE') {
            // A persisted enrollment can outlive a lost registration response. Tombstone it first,
            // so a delayed registration/upload cannot recreate data after deletion.
            const match =
                /^Bearer dgi_([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(
                    request.headers.get('authorization') ?? ''
                )
            if (match)
                await database.transaction(async transaction => {
                    const record = `installations/${match[1]}`
                    if (!(await transaction.get(record))) {
                        const quotaPath = `enrollmentQuotas/${dateKey(now())}`
                        const quota = await transaction.get(quotaPath)
                        if ((quota?.count ?? 0) >= enrollmentLimit)
                            fail(429, 'Enrollment limit reached; retry tomorrow')
                        transaction.set(quotaPath, {
                            count: (quota?.count ?? 0) + 1,
                            expiresAt: new Date(+now() + 2 * DAY),
                        })
                        transaction.set(record, {
                            keyHash: credentialHash(match[2]),
                            noticeVersion: NOTICE_VERSION,
                            createdAt: now(),
                            revoked: true,
                            pendingDeletion: false,
                            emailGeneration: 0,
                        })
                    }
                })
        }
        const { installId, keyHash } = await authenticate(database, request.headers.get('authorization') ?? '')
        if (path === '/v2/installation' && method === 'GET') {
            const install = await database.get(`installations/${installId}`)
            const contact = install?.revoked ? undefined : await database.get(`contacts/${installId}`)
            return Response.json({
                installId,
                revoked: !!install?.revoked,
                deletionPending: !!install?.pendingDeletion,
                contact: contact ? { email: contact.email, verified: true, credit: contact.credit } : null,
            })
        }
        if (path === '/v2/installation' && method === 'DELETE') {
            const result = await withdrawInstallation(database, installId, keyHash, now())
            return Response.json(result, { status: result.deletionPending ? 202 : 200 })
        }
        if (path === '/v2/batches' && method === 'POST') {
            const body = await readJson(request)
            try {
                validateBatch(body)
            } catch {
                fail(400, 'Invalid diagnostics')
            }
            const payload = JSON.stringify(body),
                sha256 = digest(payload),
                date = now()
            const recordPath = `diagnostics/${installId}_${body.id}`
            const duplicate = await database.transaction(async transaction => {
                const install = await active(transaction, installId, keyHash)
                const previous = await transaction.get(recordPath)
                if (previous) {
                    if (previous.sha256 !== sha256) fail(409, 'Batch identity already has different contents')
                    return true
                }
                const quotaPath = `uploadQuotas/${installId}_${dateKey(date)}`
                const quota = await transaction.get(quotaPath)
                if ((quota?.count ?? 0) >= DAILY_BATCH_LIMIT) fail(429, 'Daily batch limit reached')
                transaction.set(quotaPath, {
                    installId,
                    count: (quota?.count ?? 0) + 1,
                    expiresAt: new Date(+date + 2 * DAY),
                })
                transaction.set(recordPath, {
                    installId,
                    noticeVersion: install.noticeVersion,
                    schema: BATCH_SCHEMA,
                    payload,
                    sha256,
                    receivedAt: date,
                    expiresAt: new Date(+date + RETENTION_DAYS * DAY),
                    review: 'unreviewed',
                    source: '@darkgrade/contribute',
                })
                return false
            })
            return Response.json({ accepted: true, duplicate }, { status: 202 })
        }
        if (path === '/v2/contact' && method === 'POST') {
            if (!options.sendContact) fail(503, 'Email confirmation is not configured')
            const body = await readJson(request)
            exact(body, ['email', 'credit'])
            if (
                typeof body.email !== 'string' ||
                body.email.length > 254 ||
                !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(body.email)
            )
                fail(400, 'A valid email address is required')
            const email = body.email.trim().toLowerCase()
            let credit: { name: string; publish: true } | null = null
            if (body.credit !== undefined && body.credit !== null) {
                exact(body.credit, ['name', 'publish'])
                if (
                    body.credit.publish !== true ||
                    typeof body.credit.name !== 'string' ||
                    !body.credit.name.trim() ||
                    body.credit.name.length > 80 ||
                    /[\u0000-\u001f<>]/.test(body.credit.name)
                )
                    fail(400, 'Public credit requires an explicit name and choice')
                credit = { name: body.credit.name.trim(), publish: true }
            }
            const secret = randomBytes(32).toString('base64url'),
                hash = digest(secret),
                date = now()
            await database.transaction(async transaction => {
                const install = await active(transaction, installId, keyHash)
                const count = install.emailDay === dateKey(date) ? install.emailCount : 0
                if (count >= 5 || (install.lastEmailAt && +date - +install.lastEmailAt < 60_000))
                    fail(429, 'Wait before requesting another confirmation')
                const generation = install.emailGeneration + 1
                transaction.set(`installations/${installId}`, {
                    ...install,
                    emailGeneration: generation,
                    emailCount: count + 1,
                    emailDay: dateKey(date),
                    lastEmailAt: date,
                })
                transaction.set(`contactChallenges/${hash}`, {
                    installId,
                    email,
                    credit,
                    generation,
                    expiresAt: new Date(+date + 15 * 60_000),
                })
            })
            await options.sendContact!({
                email,
                confirmationUrl: `${publicUrl.origin}/confirm#${secret}`,
                idempotencyKey: hash,
            })
            return Response.json({ confirmationSent: true }, { status: 202 })
        }
        if (path === '/v2/contact' && method === 'DELETE') {
            await database.transaction(async transaction => {
                const install = await active(transaction, installId, keyHash)
                transaction.set(`installations/${installId}`, {
                    ...install,
                    emailGeneration: install.emailGeneration + 1,
                })
                transaction.delete(`contacts/${installId}`)
                changeMatrixGeneration(transaction)
            })
            await removeRows(database, 'contactChallenges', installId)
            return Response.json({ removed: true })
        }
        return fail(405, 'Method not allowed')
    }
    return async (request: Request): Promise<Response> => {
        const origin = request.headers.get('origin')
        let response: Response
        if (origin && !origins.has(origin) && origin !== publicUrl.origin)
            response = Response.json({ error: 'Origin not allowed' }, { status: 403 })
        else if (request.method === 'OPTIONS') response = new Response(null, { status: 204 })
        else
            try {
                response = await route(request)
            } catch (error) {
                response = Response.json(
                    { error: error instanceof TelemetryError ? error.message : 'Telemetry temporarily unavailable' },
                    { status: error instanceof TelemetryError ? error.status : 503 }
                )
            }
        response.headers.set('cache-control', 'no-store')
        response.headers.set('referrer-policy', 'no-referrer')
        response.headers.set('x-content-type-options', 'nosniff')
        if (response.status === 429) response.headers.set('retry-after', '3600')
        if (origin && (origins.has(origin) || origin === publicUrl.origin)) {
            response.headers.set('access-control-allow-origin', origin)
            response.headers.set('vary', 'Origin')
            response.headers.set('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS')
            response.headers.set('access-control-allow-headers', 'Authorization,Content-Type')
        }
        return response
    }
}

async function removeRows(database: Database, collection: string, installId: string, maximumPages = 5) {
    for (let page = 0; page < maximumPages; page++) {
        const rows = await database.list(collection, 'installId', installId)
        if (!rows.length) return true
        await database.transaction(async transaction => {
            for (const row of rows) transaction.delete(row.path)
        })
    }
    return false
}
/** The operator route must authenticate separately before omitting the installation key hash. */
export async function withdrawInstallation(database: Database, installId: string, keyHash?: string, date = new Date()) {
    await database.transaction(async transaction => {
        const install = await transaction.get(`installations/${installId}`)
        if (!install || (keyHash !== undefined && install.keyHash !== keyHash)) fail(401, 'Invalid installation')
        transaction.set(`installations/${installId}`, {
            ...install,
            revoked: true,
            pendingDeletion: true,
            revokedAt: install!.revokedAt ?? date,
            emailGeneration: install!.emailGeneration + 1,
        })
        changeMatrixGeneration(transaction)
    })
    const complete = await cleanupInstallation(database, installId).catch(() => false)
    return { revoked: true, deletionPending: !complete }
}
export async function cleanupInstallation(database: Database, installId: string, maximumPages = 5) {
    const install = await database.get(`installations/${installId}`)
    if (!install?.revoked) throw new Error('Cannot clean an active installation')
    let complete = true
    for (const collection of ['diagnostics', 'contacts', 'contactChallenges', 'reviewedPatterns', 'uploadQuotas'])
        if (!(await removeRows(database, collection, installId, maximumPages))) complete = false
    if (complete)
        await database.transaction(async transaction => {
            const current = await transaction.get(`installations/${installId}`)
            if (!current?.revoked) throw new Error('Missing withdrawal tombstone')
            transaction.set(`installations/${installId}`, {
                ...current,
                pendingDeletion: false,
                lastSweptAt: new Date(),
            })
        })
    return complete
}
export async function cleanupWithdrawals(database: Database) {
    const cursor = await database.get('maintenance/telemetry-withdrawals')
    const rows = await database.list('installations', 'pendingDeletion', true, cursor?.after)
    let cleaned = 0,
        failed = 0
    for (const row of rows) {
        try {
            if (await cleanupInstallation(database, row.path.split('/')[1], 500)) cleaned++
            else failed++
        } catch {
            failed++
        }
    }
    await database.transaction(async transaction => {
        transaction.set('maintenance/telemetry-withdrawals', { after: rows.length === 100 ? rows.at(-1)!.path : null })
    })
    return { cleaned, failed, more: rows.length === 100 }
}

function confirmationPage() {
    const nonce = randomBytes(18).toString('base64')
    return new Response(
        `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Confirm Darkgrade contact</title><main><h1>Darkgrade camera diagnostics</h1><p id="status">Confirming your email…</p></main>
<script nonce="${nonce}">const token=location.hash.slice(1);history.replaceState(null,'','/confirm');
fetch('/v2/contact/confirm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token}),credentials:'omit'})
.then(r=>{document.getElementById('status').textContent=r.ok?'Email confirmed. You can close this page.':'This link expired or was already used. Request a new one in the application.'})
.catch(()=>{document.getElementById('status').textContent='Confirmation could not finish. Open the email link again to retry.'});</script></html>`,
        {
            headers: {
                'content-type': 'text/html; charset=utf-8',
                'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
            },
        }
    )
}

export function resendContactSender(apiKey: string, from: string, request: typeof fetch = fetch) {
    if (!apiKey || !from || /[\r\n]/.test(from)) throw new Error('Email sender configuration required')
    return async ({ email, confirmationUrl, idempotencyKey }: ContactMessage) => {
        const result = await request('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${apiKey}`,
                'content-type': 'application/json',
                'idempotency-key': idempotencyKey,
            },
            body: JSON.stringify({
                from,
                to: [email],
                subject: 'Confirm your Darkgrade diagnostics email',
                text: `Confirm this email for your Darkgrade installation:\n${confirmationUrl}\n\nThis link expires in 15 minutes. If you did not request it, ignore this message. Diagnostics never contain your email.`,
            }),
            signal: AbortSignal.timeout(10_000),
            redirect: 'error',
        })
        if (!result.ok) throw new Error('Contact email delivery failed')
    }
}
