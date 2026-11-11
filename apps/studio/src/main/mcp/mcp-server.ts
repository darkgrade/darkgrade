import { STUDIO_TOOLS, type ToolResult } from '@main/tools/studio-tools'
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { McpServerStatus } from '@shared/ipc'
import { SHOOTING_GUIDANCE } from '@shared/shooting-guidance'
import { app } from 'electron'
import { createServer, type Server } from 'node:http'

const INSTRUCTIONS = `Darkgrade Studio controls the camera connected to this Mac. Tools adapt to whatever camera is plugged in: read get_camera_status first to see what it offers.\n\n${SHOOTING_GUIDANCE}`

function toContent(result: ToolResult) {
    const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
        { type: 'text', text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2) },
    ]
    if (result.image) content.push({ type: 'image', data: result.image.base64, mimeType: result.image.mimeType })
    return content
}

function buildServer(): McpServer {
    const server = new McpServer({ name: 'darkgrade-studio', title: 'Darkgrade Studio', version: app.getVersion() }, { instructions: INSTRUCTIONS })
    for (const tool of STUDIO_TOOLS) {
        server.registerTool(
            tool.name,
            {
                title: tool.title,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: { title: tool.title, readOnlyHint: !tool.changesSomething, openWorldHint: false },
            },
            async (input: Record<string, unknown>) => {
                try {
                    return { content: toContent(await tool.run(input ?? {})) }
                } catch (error) {
                    return { content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }], isError: true }
                }
            }
        )
    }
    return server
}

/** Serves Studio's tools to MCP clients (Claude, editors, agents) on this Mac only, while enabled in Preferences. */
class StudioMcpServer {
    private httpServer: Server | null = null
    private handler: ReturnType<typeof createMcpHandler> | null = null
    private status: McpServerStatus = { running: false, url: null, error: null }
    private listeners = new Set<(status: McpServerStatus) => void>()

    getStatus(): McpServerStatus {
        return this.status
    }

    onStatus(listener: (status: McpServerStatus) => void): () => void {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    async apply(enabled: boolean, port: number): Promise<void> {
        await this.stop()
        if (enabled) await this.start(port)
    }

    private async start(port: number): Promise<void> {
        const handler = createMcpHandler(buildServer)
        const nodeHandler = toNodeHandler(handler)
        const validateHost = localhostHostValidation()
        const validateOrigin = localhostOriginValidation()
        const server = createServer((request, response) => {
            if (!validateHost(request, response) || !validateOrigin(request, response)) return
            if (!request.url?.startsWith('/mcp')) {
                response.writeHead(404).end()
                return
            }
            void nodeHandler(request, response)
        })
        await new Promise<void>(resolve => {
            server.once('error', error => {
                this.setStatus({ running: false, url: null, error: (error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `Port ${port} is already in use` : error.message })
                resolve()
            })
            server.listen(port, '127.0.0.1', () => {
                this.httpServer = server
                this.handler = handler
                this.setStatus({ running: true, url: `http://127.0.0.1:${port}/mcp`, error: null })
                resolve()
            })
        })
    }

    async stop(): Promise<void> {
        const server = this.httpServer
        this.httpServer = null
        await this.handler?.close().catch(() => {})
        this.handler = null
        if (server) await new Promise<void>(resolve => server.close(() => resolve()))
        if (this.status.running) this.setStatus({ running: false, url: null, error: null })
    }

    private setStatus(status: McpServerStatus): void {
        this.status = status
        this.listeners.forEach(listener => listener(status))
    }
}

export const studioMcpServer = new StudioMcpServer()
