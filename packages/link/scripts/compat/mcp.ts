/**
 * The camera compatibility MCP server over stdio.
 *
 *   bun run compat:mcp [-- --url http://127.0.0.1:4174/ | --local]
 *
 * With a `compat:ui` running (at --url, COMPAT_API_URL, or http://127.0.0.1:4174/) it talks to that
 * server's HTTP API, so runs it starts show in the open UI; otherwise it reads test-results/ itself.
 * Control calls send COMPAT_API_TOKEN when it is set. Logs go to stderr; stdout carries the protocol.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CompatApi } from '@scripts/compat-ui/compat-api'
import { httpBackend, localBackend, probeUi } from '@scripts/compat-ui/compat-backend'
import { createCompatMcpServer } from '@scripts/compat-ui/compat-mcp'

const argumentsList = process.argv.slice(2)
const urlIndex = argumentsList.indexOf('--url')
const explicitUrl = urlIndex >= 0 ? argumentsList[urlIndex + 1] : process.env.COMPAT_API_URL
const uiUrl = explicitUrl ?? `http://127.0.0.1:${process.env.COMPAT_UI_PORT ?? 4174}/`
const token = process.env.COMPAT_API_TOKEN || undefined

const useHttp = !argumentsList.includes('--local') && (explicitUrl !== undefined || (await probeUi(uiUrl)))
const api = useHttp ? undefined : new CompatApi()
const backend = useHttp ? httpBackend(uiUrl, { ...(token && { token }) }) : localBackend(api!)
console.error(
    useHttp
        ? `darkgrade-compat MCP: using the compatibility UI at ${uiUrl}`
        : 'darkgrade-compat MCP: no compatibility UI running; reading test-results/ directly'
)

const server = createCompatMcpServer(backend)
await server.connect(new StdioServerTransport())
const shutdown = () => {
    api?.runner.stop()
    void server.close().then(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
