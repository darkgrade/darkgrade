import { investigate } from '#collector/investigate'
import { admissionLimit } from '#collector/abuse-limits'
import { operatorApi } from '#collector/operator'
import { postgresDatabase } from '#collector/postgres'
import { cleanupWithdrawals, createTelemetry, resendContactSender } from '#collector/telemetry'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const database = await postgresDatabase(process.env.DATABASE_URL ?? '')
const handle = createTelemetry(database, {
    publicUrl: process.env.TELEMETRY_PUBLIC_URL ?? '',
    allowedOrigins: JSON.parse(process.env.TELEMETRY_ALLOWED_ORIGINS ?? '[]'),
    ...(process.env.TELEMETRY_EMAIL_API_KEY && {
        sendContact: resendContactSender(process.env.TELEMETRY_EMAIL_API_KEY, process.env.TELEMETRY_EMAIL_FROM ?? ''),
    }),
})
const admit = admissionLimit()
const server = createServer(async (incoming, outgoing) => {
    const release = admit()
    if (!release) {
        incoming.resume()
        outgoing.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1', 'cache-control': 'no-store' })
        outgoing.end(JSON.stringify({ error: 'Collector busy; retry shortly' }))
        return
    }
    try {
        const request = new Request(`http://collector${incoming.url}`, {
            method: incoming.method,
            headers: incoming.headers as Record<string, string>,
            ...(incoming.method !== 'GET' &&
                incoming.method !== 'HEAD' && {
                    body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>,
                    duplex: 'half',
                }),
        })
        const pathname = new URL(request.url).pathname
        const result = pathname.startsWith('/internal/api/')
            ? await operatorApi(request, process.env.TELEMETRY_ADMIN_KEY, database)
            : pathname === '/internal' || pathname.startsWith('/internal/')
              ? await investigate(request, process.env.TELEMETRY_ADMIN_KEY, database.timeline)
              : pathname === '/health' || pathname === '/healthz'
                ? await database.health().then(() => Response.json({ ok: true }))
                : await handle(request)
        console.log(
            JSON.stringify({
                component: 'contribution-collector',
                status: result.status,
                outcome:
                    result.status === 429
                        ? 'quota'
                        : result.status >= 500
                          ? 'unavailable'
                          : result.status >= 400
                            ? 'rejected'
                            : 'accepted',
                method: ['POST', 'DELETE'].includes(request.method) ? request.method : 'other',
            })
        )
        outgoing.writeHead(result.status, Object.fromEntries(result.headers))
        outgoing.end(await result.text())
    } catch {
        outgoing.writeHead(500)
        outgoing.end('Collector unavailable')
    } finally {
        release()
    }
})
server.requestTimeout = 20_000
server.headersTimeout = 10_000
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')

let maintaining = false
const maintain = async () => {
    if (maintaining) return
    maintaining = true
    try {
        await database.expire()
        await cleanupWithdrawals(database)
    } catch {
        console.error('Telemetry maintenance will retry')
    } finally {
        maintaining = false
    }
}
const maintenance = setInterval(() => void maintain(), 60_000)
maintenance.unref()
void maintain()
for (const signal of ['SIGTERM', 'SIGINT'])
    process.once(signal, () => {
        clearInterval(maintenance)
        server.close(() => {
            void database.close().then(() => process.exit(0))
        })
        setTimeout(() => process.exit(1), 20_000).unref()
    })
