import { measurePerf, tracePerf } from '@main/perf-monitor'
import { preferences } from '@main/preferences'
import { STUDIO_TOOLS, type ToolResult } from '@main/tools/studio-tools'
import { VISION_TOOLS } from '@main/vision/vision-tools'
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import type { McpServerStatus } from '@shared/ipc'
import { SHOOTING_GUIDANCE } from '@shared/shooting-guidance'
import { app } from 'electron'
import { createServer, type Server } from 'node:http'
import * as z from 'zod/v4'

const INSTRUCTIONS = `Darkgrade Studio controls the camera connected to this Mac. Tools adapt to whatever camera is plugged in: read camera_get_capabilities first to see what it offers.\n\n${SHOOTING_GUIDANCE}`

function toContent(result: ToolResult) {
    const content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[] = [
        { type: 'text', text: typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2) },
    ]
    if (result.image) content.push({ type: 'image', data: result.image.base64, mimeType: result.image.mimeType })
    return content
}

function buildServer(): McpServer {
    const server = new McpServer(
        { name: 'darkgrade-studio', title: 'Darkgrade Studio', version: app.getVersion() },
        { instructions: INSTRUCTIONS }
    )
    // Developer Mode adds the vision models' tools (Depth Pro 2, SAM 3); the server restarts when it changes.
    const tools = preferences.get().developerMode ? [...STUDIO_TOOLS, ...VISION_TOOLS] : STUDIO_TOOLS
    for (const tool of tools) {
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
                    return {
                        content: [
                            { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
                        ],
                        isError: true,
                    }
                }
            }
        )
    }
    // Studio's own performance, for diagnosing it from outside (not offered to the voice assistant).
    const readOnly = (title: string) => ({ title, readOnlyHint: true, openWorldHint: false })
    const asText = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
    server.registerTool(
        'get_performance',
        {
            title: 'Performance',
            description:
                "Measures Studio for a few seconds: every process's CPU (100% is one core) and GPU (100% is the whole GPU), WindowServer for context (it composites every app, not just Studio), and the Studio window's own parts (draw loops with their GPU time, frame decode, React, each IPC event type). Read-only.",
            inputSchema: z.object({ seconds: z.number().min(1).max(10).default(3) }),
            annotations: readOnly('Performance'),
        },
        async (input: { seconds?: number }) => asText(await measurePerf(input.seconds ?? 3))
    )
    server.registerTool(
        'trace_performance',
        {
            title: 'Trace performance',
            description:
                "Records Chromium's own trace for a few seconds and returns the busiest tasks in the GPU process, the main process and the Studio window, by self time (CPU time where recorded). Use it to see inside compositing. Read-only.",
            inputSchema: z.object({ seconds: z.number().min(1).max(10).default(3) }),
            annotations: readOnly('Trace performance'),
        },
        async (input: { seconds?: number }) => asText(await tracePerf(input.seconds ?? 3))
    )
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
                this.setStatus({
                    running: false,
                    url: null,
                    error:
                        (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
                            ? `Port ${port} is already in use`
                            : error.message,
                })
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
