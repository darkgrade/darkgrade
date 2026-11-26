import { LocalServerProcess } from '@main/models/local-server'
import { join } from 'node:path'
import { app } from 'electron'

export interface LlamaServerOptions {
    binaryPath: string
    modelPath: string
    projectorPath: string
    /** Prompt context per slot. */
    contextTokens: number
    /** Requests served at once. */
    parallel: number
    /** Model-specific options, e.g. sampling or metadata overrides. */
    extraArguments: string[]
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

/** The bundled llama.cpp server (fetched by scripts/download-llama-server.ts). */
export function llamaServerBinary(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'llama-server', 'llama-server')
}

/** One llama-server on a private local port, for a model and its projector. */
export function llamaServerProcess(options: LlamaServerOptions): LocalServerProcess {
    return new LocalServerProcess({
        name: 'model server',
        command: options.binaryPath,
        args: port =>
            [
                ['--model', options.modelPath],
                ['--mmproj', options.projectorPath],
                ['--host', '127.0.0.1'],
                ['--port', String(port)],
                ['--n-gpu-layers', '99'],
                ['--parallel', String(options.parallel)],
                ['--ctx-size', String(options.contextTokens * options.parallel)],
                ['--no-webui'],
                options.extraArguments,
            ].flat(),
        startupTimeoutMs: 120_000,
        onLog: options.onLog,
        onUnexpectedExit: options.onUnexpectedExit,
    })
}
