import { createCollector } from '#collector/collector'
import { googleCloudStore } from '#collector/gcs'
import { createServer } from 'node:http'
import { Readable } from 'node:stream'

const handle = createCollector(
    googleCloudStore(process.env.CONTRIBUTION_BUCKET ?? ''),
    process.env.CONTRIBUTION_SIGNING_KEY ?? ''
)
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
