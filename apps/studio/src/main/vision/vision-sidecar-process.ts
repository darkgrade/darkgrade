import { LocalServerProcess } from '@main/models/local-server'
import { ensurePythonEnvironment, type PythonEnvironmentOptions } from '@main/models/python-environment'
import { app } from 'electron'
import { join } from 'node:path'

/** resources/vision-sidecar: the server script and its pinned requirements. The models are downloaded. */
export function visionSidecarDirectory(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'vision-sidecar')
}

/** Creates the vision models' Python environment once, and again whenever its pinned requirements change. */
export function ensureVisionEnvironment(options: PythonEnvironmentOptions): Promise<string> {
    const sidecar = visionSidecarDirectory()
    return ensurePythonEnvironment({
        ...options,
        requirements: join(sidecar, 'requirements.txt'),
        withoutDependencies: join(sidecar, 'requirements-without-dependencies.txt'),
        announce: `[studio] creating the vision environment in ${options.directory} (PyTorch, one time)`,
    })
}

export interface VisionSidecarOptions {
    pythonPath: string
    /** vision_server.py's arguments after the script: the model and its folders. */
    modelArguments: string[]
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

/** One vision model's server on a private local port. */
export function visionSidecarProcess(options: VisionSidecarOptions): LocalServerProcess {
    const script = join(visionSidecarDirectory(), 'vision_server.py')
    return new LocalServerProcess({
        name: 'vision engine',
        command: options.pythonPath,
        args: port => ['-I', script, ...options.modelArguments, '--port', String(port)],
        startupTimeoutMs: 180_000,
        onLog: options.onLog,
        onUnexpectedExit: options.onUnexpectedExit,
    })
}
