import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

export interface PythonDownloadProgress {
    receivedBytes: number
    totalBytes: number
}

export interface PinnedArchive {
    url: string
    bytes: number
    sha256: string
}

/** python-build-standalone's CPython 3.11 for Apple Silicon: a relocatable Python that needs no installer. */
export const STANDALONE_PYTHON: PinnedArchive = {
    url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261110/cpython-3.11.18%2B20261110-aarch64-apple-darwin-install_only_stripped.tar.gz',
    bytes: 26_982_722,
    sha256: '3afb0567b2a2b30b3a7341bd143cb4e8a69f3d8e95d4641218eaa45f0fabbd07',
}

export interface PythonRuntimeOptions {
    /** Where a downloaded Python is kept. */
    directory: string
    archive?: PinnedArchive
    fetchArchive?: typeof fetch
}

/** Studio's own private Python 3.11, downloaded into the app's data folder and kept apart from any on the Mac. */
export class PythonRuntime {
    private readonly archive: PinnedArchive
    private readonly fetchArchive: typeof fetch

    constructor(private readonly options: PythonRuntimeOptions) {
        this.archive = options.archive ?? STANDALONE_PYTHON
        this.fetchArchive = options.fetchArchive ?? fetch
    }

    private get downloadedPythonPath(): string {
        return join(this.options.directory, 'python', 'bin', 'python3.11')
    }

    /** Identifies this exact Python, so environments built on another one are rebuilt. */
    get identity(): string {
        return this.archive.sha256
    }

    /** Studio always runs its own Python, never one the Mac already has, so it cannot clash with it. */
    async ensure(onProgress: (progress: PythonDownloadProgress) => void): Promise<string> {
        if (!existsSync(this.downloadedPythonPath)) await this.download(onProgress)
        return this.downloadedPythonPath
    }

    private async download(onProgress: (progress: PythonDownloadProgress) => void): Promise<void> {
        const isAppleSilicon = process.platform === 'darwin' && process.arch === 'arm64'
        if (!this.options.archive && !isAppleSilicon) {
            throw new Error('Voice needs a Mac with Apple silicon')
        }
        const { directory } = this.options
        mkdirSync(directory, { recursive: true })
        const archivePath = join(directory, 'python.tar.gz.part')
        const response = await this.fetchArchive(this.archive.url)
        if (!response.ok || !response.body) throw new Error(`Couldn't download Python (HTTP ${response.status})`)

        let receivedBytes = 0
        const body = Readable.fromWeb(response.body as never)
        body.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length
            onProgress({ receivedBytes, totalBytes: this.archive.bytes })
        })
        await pipeline(body, createWriteStream(archivePath))

        const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
        if (digest !== this.archive.sha256) {
            rmSync(archivePath, { force: true })
            throw new Error('The Python download was damaged or changed; try again')
        }
        const unpackDirectory = join(directory, 'unpacking')
        rmSync(unpackDirectory, { recursive: true, force: true })
        mkdirSync(unpackDirectory, { recursive: true })
        await runFile('tar', ['-xzf', archivePath, '-C', unpackDirectory])
        rmSync(join(directory, 'python'), { recursive: true, force: true })
        renameSync(join(unpackDirectory, 'python'), join(directory, 'python'))
        rmSync(unpackDirectory, { recursive: true, force: true })
        rmSync(archivePath, { force: true })
    }
}
