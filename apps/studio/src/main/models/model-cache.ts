import type { SpeechModelId } from '@shared/speech-models'
import type { DepthModelSize } from '@shared/vision-models'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
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
    /**
     * Gated on Hugging Face: downloading needs a token from an account that accepted the model's licence there.
     * The value is the page where the licence is accepted.
     */
    gatedLicencePage?: string
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

const BARK_LOADING_CODE_SHA256 = {
    barkMlx: '79b976c8711a0a16a6d013d7ff365db73af05edabe0c8fb297e39ad7a54b92a1',
    barkLoader: 'e86b7f130bec1a8fa14dd315cfce95785b890dbd30000f6ceb2597fdd4312b02',
}

/**
 * An MLX Bark model: weights, tokenizer and the model's own loading code, which is checked against
 * known hashes before the speech sidecar imports it.
 */
function mlxBarkModel(
    id: string,
    repository: string,
    revision: string,
    modelBytes: number,
    noticeBytes: number
): CachedModel {
    const base = `https://huggingface.co/ConwayResearch/${repository}/resolve/${revision}`
    return {
        id: `underdog-${id}`,
        files: [
            { name: 'model.bark', url: `${base}/model.bark`, bytes: modelBytes },
            { name: 'mlx/config.json', url: `${base}/mlx/config.json`, bytes: 237_042 },
            { name: 'mlx/tokenizer.model', url: `${base}/mlx/tokenizer.model`, bytes: 360_621 },
            { name: 'mlx/tokenizer.vocab', url: `${base}/mlx/tokenizer.vocab`, bytes: 101_024 },
            { name: 'mlx/vocab.txt', url: `${base}/mlx/vocab.txt`, bytes: 46_772 },
            { name: 'bark_mlx.py', url: `${base}/bark_mlx.py`, bytes: 5_011, sha256: BARK_LOADING_CODE_SHA256.barkMlx },
            {
                name: 'bark_loader.py',
                url: `${base}/bark_loader.py`,
                bytes: 5_820,
                sha256: BARK_LOADING_CODE_SHA256.barkLoader,
            },
            { name: 'LICENSE', url: `${base}/LICENSE`, bytes: 19_347 },
            { name: 'NOTICE', url: `${base}/NOTICE`, bytes: noticeBytes },
        ],
    }
}

const BARK_PRO_REPOSITORY =
    'https://huggingface.co/ConwayResearch/Underdog-Bark-3.0-Pro/resolve/d87f288a9a0b0cdb92228057e168ce575b300a6b'

/**
 * Conway Research's Underdog Bark 3.0 family (CC BY-NC 4.0), downloaded by the user from Hugging Face
 * at pinned revisions. Plus is Voicebench's most accurate and fastest. Pro runs through transformers
 * (no code from the model folder is executed).
 */
export const SPEECH_MODEL_FILES: Record<SpeechModelId, CachedModel> = {
    'bark-3.0': mlxBarkModel(
        'bark-3.0',
        'Underdog-Bark-3.0',
        'e7a641c0fdd4cdf1818dde62a98c26e11d65c061',
        163_398_645,
        747
    ),
    'bark-3.0-plus': mlxBarkModel(
        'bark-3.0-plus',
        'Underdog-Bark-3.0-Plus',
        '28a7d4234146b0f01c11e0c6b72dfa29028a4758',
        179_524_845,
        757
    ),
    'bark-3.0-pro': {
        id: 'underdog-bark-3.0-pro',
        files: [
            { name: 'model.safetensors', url: `${BARK_PRO_REPOSITORY}/model.safetensors`, bytes: 1_254_196_636 },
            { name: 'config.json', url: `${BARK_PRO_REPOSITORY}/config.json`, bytes: 1_174 },
            { name: 'generation_config.json', url: `${BARK_PRO_REPOSITORY}/generation_config.json`, bytes: 285 },
            { name: 'processor_config.json', url: `${BARK_PRO_REPOSITORY}/processor_config.json`, bytes: 392 },
            { name: 'tokenizer.json', url: `${BARK_PRO_REPOSITORY}/tokenizer.json`, bytes: 1_159_960 },
            { name: 'tokenizer_config.json', url: `${BARK_PRO_REPOSITORY}/tokenizer_config.json`, bytes: 290 },
            { name: 'LICENSE', url: `${BARK_PRO_REPOSITORY}/LICENSE`, bytes: 19_347 },
            { name: 'NOTICE', url: `${BARK_PRO_REPOSITORY}/NOTICE`, bytes: 755 },
        ],
    },
}

/** Pinned Hugging Face revision per model, for the engine log. */
export const SPEECH_MODEL_REVISIONS: Record<SpeechModelId, string> = {
    'bark-3.0': 'e7a641c0fdd4cdf1818dde62a98c26e11d65c061',
    'bark-3.0-plus': '28a7d4234146b0f01c11e0c6b72dfa29028a4758',
    'bark-3.0-pro': 'd87f288a9a0b0cdb92228057e168ce575b300a6b',
}

/** Depth Pro 2's weights per size (Apple Machine Learning Research Model licence), pinned to revisions. */
const DEPTH_PRO_2_REVISIONS: Record<
    DepthModelSize,
    { repository: string; revision: string; modelBytes: number; configBytes: number }
> = {
    S: {
        repository: 'DepthPro2-S',
        revision: '903a1c1ade918831d138adcc4aedbcc8f4da0078',
        modelBytes: 97_264_508,
        configBytes: 268,
    },
    B: {
        repository: 'DepthPro2-B',
        revision: '85e67fdfb7f5b36a6f6c4495e6789d331b1d8a04',
        modelBytes: 386_076_596,
        configBytes: 269,
    },
    L: {
        repository: 'DepthPro2-L',
        revision: '849dc5461267e0bc006ec63ab46920ea1ed98702',
        modelBytes: 1_335_873_268,
        configBytes: 318,
    },
    H: {
        repository: 'DepthPro2-H',
        revision: '68426c789f75a7c760273e857222625b4fe69576',
        modelBytes: 3_488_493_012,
        configBytes: 338,
    },
}

function depthPro2Files(repository: string, revision: string, modelBytes: number, configBytes: number): ModelFile[] {
    const base = `https://huggingface.co/apple/${repository}/resolve/${revision}`
    return [
        { name: 'model.safetensors', url: `${base}/model.safetensors`, bytes: modelBytes },
        { name: 'config.json', url: `${base}/config.json`, bytes: configBytes },
        { name: 'LICENSE', url: `${base}/LICENSE`, bytes: 5_815 },
    ]
}

export function depthPro2Model(size: DepthModelSize): CachedModel {
    const { repository, revision, modelBytes, configBytes } = DEPTH_PRO_2_REVISIONS[size]
    return {
        id: `apple-${repository.toLowerCase()}`,
        files: depthPro2Files(repository, revision, modelBytes, configBytes),
    }
}

/** The focal length estimator every Depth Pro 2 size loads, for pictures whose focal length isn't known. */
export const DEPTH_PRO_2_FOCAL: CachedModel = {
    id: 'apple-depthpro2-focal',
    files: depthPro2Files('DepthPro2-focal', '622659d44a2002cf9ae4333f2569afa938290d9a', 93_840_880, 3),
}

const SAM_3_REPOSITORY = 'https://huggingface.co/facebook/sam3/resolve/3c879f39826c281e95690f02c7821c4de09afae7'

/** Meta's SAM 3 (SAM licence), as transformers loads it; gated on Hugging Face. */
export const SAM_3: CachedModel = {
    id: 'facebook-sam3',
    gatedLicencePage: 'https://huggingface.co/facebook/sam3',
    files: [
        { name: 'model.safetensors', url: `${SAM_3_REPOSITORY}/model.safetensors`, bytes: 3_439_938_512 },
        { name: 'config.json', url: `${SAM_3_REPOSITORY}/config.json`, bytes: 25_843 },
        { name: 'processor_config.json', url: `${SAM_3_REPOSITORY}/processor_config.json`, bytes: 1_712 },
        { name: 'tokenizer.json', url: `${SAM_3_REPOSITORY}/tokenizer.json`, bytes: 3_642_073 },
        { name: 'tokenizer_config.json', url: `${SAM_3_REPOSITORY}/tokenizer_config.json`, bytes: 799 },
        { name: 'special_tokens_map.json', url: `${SAM_3_REPOSITORY}/special_tokens_map.json`, bytes: 588 },
        { name: 'vocab.json', url: `${SAM_3_REPOSITORY}/vocab.json`, bytes: 862_328 },
        { name: 'merges.txt', url: `${SAM_3_REPOSITORY}/merges.txt`, bytes: 524_619 },
        { name: 'LICENSE', url: `${SAM_3_REPOSITORY}/LICENSE`, bytes: 7_352 },
    ],
}

/**
 * The Hugging Face token for gated models: HF_TOKEN, or the one `hf auth login` saved. Never logged.
 */
export function huggingFaceToken(environment: NodeJS.ProcessEnv = process.env, home = homedir()): string | null {
    if (environment.HF_TOKEN?.trim()) return environment.HF_TOKEN.trim()
    const saved = join(environment.HF_HOME ?? join(home, '.cache', 'huggingface'), 'token')
    return existsSync(saved) ? readFileSync(saved, 'utf8').trim() || null : null
}

/** Why a gated model couldn't be downloaded, and what to do about it. */
export function gatedModelMessage(model: CachedModel, hasToken: boolean): string {
    return hasToken
        ? `This Hugging Face account hasn't been given access yet: accept the licence at ${model.gatedLicencePage}, then try again`
        : `This model is gated: accept its licence at ${model.gatedLicencePage}, then sign in with \`hf auth login\` (or set HF_TOKEN) and try again`
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
    constructor(
        private readonly directory: string,
        private readonly readToken: () => string | null = huggingFaceToken
    ) {}

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

        const headers: Record<string, string> = startByte > 0 ? { Range: `bytes=${startByte}-` } : {}
        const token = model.gatedLicencePage ? this.readToken() : null
        if (token) headers.Authorization = `Bearer ${token}`
        const response = await fetch(file.url, { headers, signal })
        if (model.gatedLicencePage && (response.status === 401 || response.status === 403))
            throw new Error(gatedModelMessage(model, token !== null))
        if (!response.ok || !response.body) throw new Error(`Couldn't download ${file.name} (HTTP ${response.status})`)
        const resumed = response.status === 206
        let receivedBytes = resumed ? startByte : 0

        const body = Readable.fromWeb(response.body as never)
        body.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length
            onBytes(receivedBytes)
        })
        await pipeline(body, createWriteStream(partialPath, { flags: resumed ? 'a' : 'w' }), { signal })

        if (!isComplete(partialPath, file))
            throw new Error(`${file.name} downloaded incompletely or changed; try again`)
        renameSync(partialPath, finalPath)
    }
}
