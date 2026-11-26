import { LocalServerProcess } from '@main/models/local-server'
import {
    addPythonRequirements,
    ensurePythonEnvironment,
    type PythonEnvironmentOptions,
} from '@main/models/python-environment'
import type { SpeechModelChoice } from '@shared/speech-models'
import { app } from 'electron'
import { join } from 'node:path'

/** Bark ships only Python code, so it runs in a Python sidecar (an approved exception to Studio's TypeScript-only rule). */
export interface BarkSidecarOptions {
    /** The chosen model's download (see SPEECH_MODEL_FILES in model-cache). */
    modelDirectory: string
    runner: SpeechModelChoice['runner']
    /** The environment's python, from ensureBarkEnvironment. */
    pythonPath: string
    onLog: (line: string) => void
    /** The process stopped without being asked to. */
    onUnexpectedExit: (description: string) => void
}

/** resources/bark-sidecar: the server script and its pinned requirements. The model and its code are downloaded. */
export function barkSidecarDirectory(): string {
    const base = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
    return join(base, 'bark-sidecar')
}

/**
 * Creates the speech environment once, and again whenever the pinned requirements change. Bark 3.0
 * Pro's PyTorch and transformers are added the first time Pro is chosen.
 */
export async function ensureBarkEnvironment(
    environment: PythonEnvironmentOptions,
    runner: SpeechModelChoice['runner']
): Promise<string> {
    const sidecar = barkSidecarDirectory()
    const pythonPath = await ensurePythonEnvironment({
        ...environment,
        requirements: join(sidecar, 'requirements.txt'),
        withoutDependencies: join(sidecar, 'requirements-without-dependencies.txt'),
        announce: `[studio] creating the speech environment in ${environment.directory}`,
    })
    if (runner === 'transformers')
        await addPythonRequirements({
            ...environment,
            requirements: join(sidecar, 'requirements-transformers.txt'),
            stampName: 'requirements-transformers.sha256',
            announce: '[studio] adding PyTorch and transformers for Bark 3.0 Pro (one time)',
        })
    return pythonPath
}

/** The Bark transcription server on a private local port. The first start unpacks model.bark into an MLX folder (about a minute). */
export function barkSidecarProcess(options: BarkSidecarOptions): LocalServerProcess {
    const script = join(barkSidecarDirectory(), 'transcription_server.py')
    return new LocalServerProcess({
        name: 'speech engine',
        command: options.pythonPath,
        args: port => ['-I', script, '--runner', options.runner, '--path', options.modelDirectory, '--port', String(port)],
        startupTimeoutMs: 300_000,
        onLog: options.onLog,
        onUnexpectedExit: options.onUnexpectedExit,
    })
}
