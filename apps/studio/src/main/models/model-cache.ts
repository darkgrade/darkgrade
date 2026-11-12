import { createWriteStream, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ModelFile {
    name: string
    url: string
    /** Exact size on Hugging Face; a cached file of any other size is downloaded again. */
    bytes: number
}

export interface CachedModel {
    id: string
    files: ModelFile[]
}


const QWEN_REPOSITORY = 'https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main'

/**
 * The assistant: Qwen3.5 4B (Apache 2.0), a general model with tool calling that also reads images,
 * with its vision encoder. Sized for a 16 GB Mac alongside the speech model; larger Macs can use the 9B later.
 */
export const QWEN_ASSISTANT: CachedModel = {
    id: 'qwen3.5-4b',
    files: [
        { name: 'Qwen3.5-4B-Q4_K_M.gguf', url: `${QWEN_REPOSITORY}/Qwen3.5-4B-Q4_K_M.gguf`, bytes: 2_740_937_888 },
        { name: 'mmproj-F16.gguf', url: `${QWEN_REPOSITORY}/mmproj-F16.gguf`, bytes: 672_423_616 },
    ],
}

const BARK_PLUS_REPOSITORY =
    'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Plus/resolve/28a7d4234146b0f01c11e0c6b72dfa29028a4758'

/**
 * Conway Research's Underdog Bark 3.0 Plus (CC BY-NC 4.0), Voicebench's most accurate and fastest
 * model. Pinned to the revision whose code is vendored in resources/bark-sidecar.
 */
export const BARK_PLUS: CachedModel = {
    id: 'underdog-bark-3.0-plus',
    files: [
        { name: 'model.bark', url: `${BARK_PLUS_REPOSITORY}/model.bark`, bytes: 179_524_845 },
        { name: 'mlx/config.json', url: `${BARK_PLUS_REPOSITORY}/mlx/config.json`, bytes: 237_042 },
        { name: 'mlx/tokenizer.model', url: `${BARK_PLUS_REPOSITORY}/mlx/tokenizer.model`, bytes: 360_621 },
        { name: 'mlx/tokenizer.vocab', url: `${BARK_PLUS_REPOSITORY}/mlx/tokenizer.vocab`, bytes: 101_024 },
        { name: 'mlx/vocab.txt', url: `${BARK_PLUS_REPOSITORY}/mlx/vocab.txt`, bytes: 46_772 },
    ],
}

export interface ModelDownloadProgress {
    receivedBytes: number
    totalBytes: number
}

function fileSize(path: string): number {
    return existsSync(path) ? statSync(path).size : 0
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
        return model.files.every(file => fileSize(this.filePath(model, file)) === file.bytes)
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
        if (fileSize(finalPath) === file.bytes) {
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

        if (fileSize(partialPath) !== file.bytes) throw new Error(`${file.name} downloaded incompletely; try again`)
        renameSync(partialPath, finalPath)
    }
}
