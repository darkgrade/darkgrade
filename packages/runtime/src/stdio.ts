import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { HttpCameraClient } from './http-client.ts'
import { createCameraMcpServer } from './mcp.ts'

const host = process.env.DARKGRADE_RUNTIME_URL
if (!host)
    throw new Error(
        'Set DARKGRADE_RUNTIME_URL to the existing session-owning host; no hardware session will be opened by this process'
    )
await serveStdio(() => createCameraMcpServer(new HttpCameraClient(host)))
