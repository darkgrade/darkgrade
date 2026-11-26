import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { HttpCameraClient } from '@runtime/http-client'
import { createCameraMcpServer } from '@runtime/mcp'

const host = process.env.DARKGRADE_RUNTIME_URL
const missingHost = 'Set DARKGRADE_RUNTIME_URL to the existing session-owning host; no hardware session will be opened by this process'
if (!host) throw new Error(missingHost)
await serveStdio(() => createCameraMcpServer(new HttpCameraClient(host)))
