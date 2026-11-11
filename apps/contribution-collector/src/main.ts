import { firestoreDatabase } from '#collector/database'
import { createTelemetry, resendContactSender } from '#collector/telemetry'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const database = firestoreDatabase(process.env.GOOGLE_CLOUD_PROJECT ?? '', {
    ...(process.env.FIRESTORE_EMULATOR_HOST && { emulator: process.env.FIRESTORE_EMULATOR_HOST }),
})
const handle = createTelemetry(database, {
    publicUrl: process.env.TELEMETRY_PUBLIC_URL ?? '',
    allowedOrigins: JSON.parse(process.env.TELEMETRY_ALLOWED_ORIGINS ?? '[]'),
    ...(process.env.TELEMETRY_EMAIL_API_KEY && {
        sendContact: resendContactSender(process.env.TELEMETRY_EMAIL_API_KEY, process.env.TELEMETRY_EMAIL_FROM ?? ''),
    }),
})
const server = createServer(async (incoming, outgoing) => {
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
        const result = await handle(request)
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
    }
})
server.requestTimeout = 20_000
server.headersTimeout = 10_000
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
