import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ModelFile {
    name: string
    url: string
    /** Exact size on Hugging Face; a cached file of any other size is downloaded again. */
    bytes: number
    /** For code and small files: the sha256 a download must match before it is used. */
    sha256?: string
}

export interface CachedModel {
    id: string
    files: ModelFile[]
}


const NEMOTRON_REPOSITORY =
    'https://huggingface.co/unsloth/NVIDIA-Nemotron-3.5-Bolt-E4B-GGUF/resolve/b738967d6da3441a7d1c71fcec15e49e32e16ecd'

/**
 * The assistant: NVIDIA Nemotron 3.5 Bolt E4B (NVIDIA Open Model License), Toolbench's best tool
 * caller for its size, with its vision projector so tool results can show it camera frames.
 * The same quantisation Toolbench scored; pinned to a revision.
 */
export const NEMOTRON_ASSISTANT: CachedModel = {
    id: 'nemotron-3.5-bolt-e4b',
    files: [
        {
            name: 'NVIDIA-Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL.gguf',
            url: `${NEMOTRON_REPOSITORY}/NVIDIA-Nemotron-3.5-Bolt-E4B-UD-Q4_K_XL.gguf`,
            bytes: 5_060_482_240,
        },
        { name: 'mmproj-F16.gguf', url: `${NEMOTRON_REPOSITORY}/mmproj-F16.gguf`, bytes: 990_373_568 },
    ],
}

const BARK_PLUS_REPOSITORY =
    'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Plus/resolve/28a7d4234146b0f01c11e0c6b72dfa29028a4758'

/**
 * Conway Research's Underdog Bark 3.0 Plus (CC BY-NC 4.0), Voicebench's most accurate and fastest
 * model. Downloaded by the user from Hugging Face at a pinned revision, with the model's own loading
 * code; that code is checked against known hashes before the speech sidecar imports it.
 */
export const BARK_PLUS: CachedModel = {
    id: 'underdog-bark-3.0-plus',
    files: [
        { name: 'model.bark', url: `${BARK_PLUS_REPOSITORY}/model.bark`, bytes: 179_524_845 },
        { name: 'mlx/config.json', url: `${BARK_PLUS_REPOSITORY}/mlx/config.json`, bytes: 237_042 },
        { name: 'mlx/tokenizer.model', url: `${BARK_PLUS_REPOSITORY}/mlx/tokenizer.model`, bytes: 360_621 },
        { name: 'mlx/tokenizer.vocab', url: `${BARK_PLUS_REPOSITORY}/mlx/tokenizer.vocab`, bytes: 101_024 },
        { name: 'mlx/vocab.txt', url: `${BARK_PLUS_REPOSITORY}/mlx/vocab.txt`, bytes: 46_772 },
        {
            name: 'bark_mlx.py',
            url: `${BARK_PLUS_REPOSITORY}/bark_mlx.py`,
            bytes: 5_011,
            sha256: '79b976c8711a0a16a6d013d7ff365db73af05edabe0c8fb297e39ad7a54b92a1',
        },
        {
            name: 'bark_loader.py',
            url: `${BARK_PLUS_REPOSITORY}/bark_loader.py`,
            bytes: 5_820,
            sha256: 'e86b7f130bec1a8fa14dd315cfce95785b890dbd30000f6ceb2597fdd4312b02',
        },
        { name: 'LICENSE', url: `${BARK_PLUS_REPOSITORY}/LICENSE`, bytes: 19_347 },
        { name: 'NOTICE', url: `${BARK_PLUS_REPOSITORY}/NOTICE`, bytes: 757 },
    ],
}

export interface ModelDownloadProgress {
    receivedBytes: number
    totalBytes: number
}

function fileSize(path: string): number {
    return existsSync(path) ? statSync(path).size : 0
}

function isComplete(path: string, file: ModelFile): boolean {
    if (fileSize(path) !== file.bytes) return false
    if (!file.sha256) return true
    return createHash('sha256').update(readFileSync(path)).digest('hex') === file.sha256
}

export function totalModelBytes(model: CachedModel): number {
    return model.files.reduce((sum, file) => sum + file.bytes, 0)
}

/** Downloads each file once into `directory/model.id`, resuming partial downloads, and returns the file paths. */
export class ModelCache {
    constructor(private readonly directory: string) {}

    modelDirectory(model: CachedModel): string {
        return join(this.directory, model.id)
    }

    filePath(model: CachedModel, file: ModelFile): string {
        return join(this.modelDirectory(model), file.name)
    }

    isCached(model: CachedModel): boolean {
        return model.files.every(file => isComplete(this.filePath(model, file), file))
    }

    async ensure(
        model: CachedModel,
        onProgress: (progress: ModelDownloadProgress) => void,
        signal?: AbortSignal
    ): Promise<string[]> {
        mkdirSync(this.modelDirectory(model), { recursive: true })
        const totalBytes = totalModelBytes(model)
        const received = new Map<string, number>()
        const report = (): void => {
            const receivedBytes = [...received.values()].reduce((sum, bytes) => sum + bytes, 0)
            onProgress({ receivedBytes, totalBytes })
        }
        await Promise.all(
            model.files.map(file =>
                this.downloadFile(
                    model,
                    file,
                    bytes => {
                        received.set(file.name, bytes)
                        report()
                    },
                    signal
                )
            )
        )
        return model.files.map(file => this.filePath(model, file))
    }

    private async downloadFile(
        model: CachedModel,
        file: ModelFile,
        onBytes: (bytes: number) => void,
        signal?: AbortSignal
    ): Promise<void> {
        const finalPath = this.filePath(model, file)
        if (isComplete(finalPath, file)) {
            onBytes(file.bytes)
            return
        }
        const partialPath = `${finalPath}.part`
        mkdirSync(dirname(partialPath), { recursive: true })
        let startByte = fileSize(partialPath)
        if (startByte > file.bytes) startByte = 0
        onBytes(startByte)

        const response = await fetch(file.url, {
            headers: startByte > 0 ? { Range: `bytes=${startByte}-` } : {},
            signal,
        })
        if (!response.ok || !response.body) throw new Error(`Couldn't download ${file.name} (HTTP ${response.status})`)
        const resumed = response.status === 206
        let receivedBytes = resumed ? startByte : 0

        const body = Readable.fromWeb(response.body as never)
        body.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length
            onBytes(receivedBytes)
        })
        await pipeline(body, createWriteStream(partialPath, { flags: resumed ? 'a' : 'w' }), { signal })

        if (!isComplete(partialPath, file)) throw new Error(`${file.name} downloaded incompletely or changed; try again`)
        renameSync(partialPath, finalPath)
    }
}
