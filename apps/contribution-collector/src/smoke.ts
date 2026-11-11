import { BATCH_SCHEMA, NOTICE_VERSION } from '@darkgrade/contribute/batch'
import { DISCLOSURE, SCHEMA } from '@darkgrade/contribute/schema'
import { randomUUID } from 'node:crypto'

const endpoint = new URL(process.env.TELEMETRY_SMOKE_URL ?? '')
if (
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash ||
    (endpoint.protocol !== 'https:' &&
        !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)))
)
    throw new Error('Use HTTPS or a local test endpoint')
let key: string | undefined
async function call(path: string, method = 'GET', body?: unknown, credential = key) {
    return fetch(new URL(path, endpoint), {
        method,
        headers: {
            ...(credential && { authorization: `Bearer ${credential}` }),
            ...(body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(30_000),
        redirect: 'error',
    })
}
async function expect(response: Response, status: number) {
    if (response.status !== status) throw new Error(`Smoke check expected ${status}, received ${response.status}`)
    return response.json() as Promise<Record<string, any>>
}
try {
    await expect(await call('/healthz'), 200)
    const notice = await expect(await call('/v2/notice'), 200)
    if (notice.version !== NOTICE_VERSION) throw new Error('Notice version mismatch')
    const enrollment = await expect(await call('/v2/installations', 'POST', { noticeVersion: NOTICE_VERSION }), 201)
    key = enrollment.installKey
    const batch = {
        schema: BATCH_SCHEMA,
        id: randomUUID(),
        contributions: [
            {
                schema: SCHEMA,
                disclosure: DISCLOSURE,
                id: randomUUID(),
                camera: {
                    manufacturer: 'Darkgrade',
                    model: 'Deployment smoke fixture',
                    firmware: 'unknown',
                    revision: '0000000',
                    dirty: true,
                    evidence: 'synthetic',
                    transport: 'usb',
                },
                entries: [
                    {
                        kind: 'command',
                        direction: 'out',
                        code: 0x1001,
                        bytes: 12,
                        durationMilliseconds: 1,
                        failed: false,
                    },
                ],
                droppedEntries: 0,
            },
        ],
    }
    await expect(await call('/v2/batches', 'POST', batch), 202)
    const duplicate = await expect(await call('/v2/batches', 'POST', batch), 202)
    if (!duplicate.duplicate) throw new Error('Retry created a duplicate')
    await expect(await call('/v2/installation', 'GET', undefined, 'invalid'), 401)
    const withdrawal = await expect(await call('/v2/installation', 'DELETE'), 200)
    if (!withdrawal.revoked || withdrawal.deletionPending) throw new Error('Deletion did not complete')
    await expect(await call('/v2/batches', 'POST', batch), 410)
    key = undefined
    console.log(JSON.stringify({ smoke: 'passed', hardwareTested: false }))
} finally {
    if (key) {
        const response = await call('/v2/installation', 'DELETE')
        if (![200, 202].includes(response.status)) throw new Error('Smoke fixture cleanup must be retried')
    }
}
