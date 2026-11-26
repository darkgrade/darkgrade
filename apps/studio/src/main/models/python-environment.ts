import type { PythonDownloadProgress, PythonRuntime } from '@main/voice/python-runtime'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

export type EnvironmentProgress = { step: 'python' | 'tools' } & PythonDownloadProgress

export interface PythonEnvironmentOptions {
    /** Where the environment is created and kept. */
    directory: string
    /** Studio's own Python 3.11; environments are built on it and rebuilt if it changes. */
    pythonRuntime: Pick<PythonRuntime, 'ensure' | 'identity'>
    /** Which step is under way: getting Python, then installing its packages. */
    onSetupProgress: (progress: EnvironmentProgress) => void
    onLog: (line: string) => void
}

/** The requirements and the Python they were installed on, so a change of either rebuilds. */
function requirementsStamp(paths: string[], pythonIdentity: string): string {
    const hash = createHash('sha256').update(pythonIdentity)
    for (const path of paths) hash.update(readFileSync(path))
    return hash.digest('hex')
}

function installed(directory: string, stampName: string, stamp: string): boolean {
    const path = join(directory, stampName)
    return existsSync(path) && readFileSync(path, 'utf8') === stamp
}

function pipInstall(directory: string, pipArguments: string[]) {
    return runFile(join(directory, 'bin', 'pip'), ['install', '--quiet', ...pipArguments], {
        maxBuffer: 16 * 1024 * 1024,
    })
}

/**
 * A sidecar's Python environment, created once and again whenever its pinned requirements (a file
 * installed with dependencies, then one without) or Studio's Python change. Returns its python.
 */
export async function ensurePythonEnvironment(
    options: PythonEnvironmentOptions & { requirements: string; withoutDependencies: string; announce: string }
): Promise<string> {
    const { directory } = options
    const pythonPath = join(directory, 'bin', 'python')
    const stamp = requirementsStamp([options.requirements, options.withoutDependencies], options.pythonRuntime.identity)
    if (existsSync(pythonPath) && installed(directory, 'requirements.sha256', stamp)) return pythonPath
    options.onLog(options.announce)
    const python = await options.pythonRuntime.ensure(progress => options.onSetupProgress({ step: 'python', ...progress }))
    options.onSetupProgress({ step: 'tools', receivedBytes: 0, totalBytes: 0 })
    await runFile(python, ['-m', 'venv', '--clear', directory])
    await pipInstall(directory, ['--requirement', options.requirements])
    await pipInstall(directory, ['--no-deps', '--requirement', options.withoutDependencies])
    writeFileSync(join(directory, 'requirements.sha256'), stamp)
    return pythonPath
}

/** Adds a further requirements file to an environment, once per version of it (`<name>.sha256`). */
export async function addPythonRequirements(
    options: PythonEnvironmentOptions & { requirements: string; stampName: string; announce: string }
): Promise<void> {
    const stamp = requirementsStamp([options.requirements], options.pythonRuntime.identity)
    if (installed(options.directory, options.stampName, stamp)) return
    options.onSetupProgress({ step: 'tools', receivedBytes: 0, totalBytes: 0 })
    options.onLog(options.announce)
    await pipInstall(options.directory, ['--requirement', options.requirements])
    writeFileSync(join(options.directory, options.stampName), stamp)
}
