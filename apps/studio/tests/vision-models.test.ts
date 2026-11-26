import {
    DEPTH_PRO_2_FOCAL,
    depthPro2Model,
    huggingFaceToken,
    ModelCache,
    SAM_3,
    type CachedModel,
} from '@main/models/model-cache'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let workDirectory: string

beforeEach(() => {
    workDirectory = mkdtempSync(join(tmpdir(), 'vision-models-'))
})
afterEach(() => {
    vi.unstubAllGlobals()
    rmSync(workDirectory, { recursive: true, force: true })
})

const tinyModel = (gated: boolean): CachedModel => ({
    id: 'tiny',
    files: [{ name: 'weights.bin', url: 'https://huggingface.test/weights.bin', bytes: 4 }],
    ...(gated ? { gatedLicencePage: 'https://huggingface.test/tiny' } : {}),
})

/** A fetch that records each request's headers and answers with `status` (four bytes when 200). */
function recordingFetch(status: number, seen: Headers[]): typeof fetch {
    return (async (_url: string, init?: RequestInit) => {
        seen.push(new Headers(init?.headers))
        return new Response(status === 200 ? new Uint8Array([1, 2, 3, 4]) : 'denied', { status })
    }) as unknown as typeof fetch
}

describe('vision model files', () => {
    it('pins every Depth Pro 2 size, the focal estimator and gated SAM 3 to a revision', () => {
        for (const size of ['S', 'B', 'L', 'H'] as const)
            expect(depthPro2Model(size).files.map(file => file.name)).toEqual(['model.safetensors', 'config.json', 'LICENSE'])
        expect(DEPTH_PRO_2_FOCAL.files[0].url).toContain('apple/DepthPro2-focal')
        expect(SAM_3.gatedLicencePage).toBe('https://huggingface.co/facebook/sam3')
        for (const file of SAM_3.files) expect(file.url).toContain('facebook/sam3/')
        const models = [...(['S', 'B', 'L', 'H'] as const).map(depthPro2Model), DEPTH_PRO_2_FOCAL, SAM_3]
        for (const file of models.flatMap(model => model.files)) expect(file.url).toMatch(/\/resolve\/[0-9a-f]{40}\//)
    })
})

describe('gated downloads', () => {
    it('sends the Hugging Face token only for gated models', async () => {
        const seen: Headers[] = []
        vi.stubGlobal('fetch', recordingFetch(200, seen))
        await new ModelCache(join(workDirectory, 'open'), () => 'hf_secret').ensure(tinyModel(false), () => {})
        await new ModelCache(join(workDirectory, 'gated'), () => 'hf_secret').ensure(tinyModel(true), () => {})
        expect(seen[0].get('authorization')).toBeNull()
        expect(seen[1].get('authorization')).toBe('Bearer hf_secret')
    })

    it('says how to get access when Hugging Face refuses a gated download', async () => {
        vi.stubGlobal('fetch', recordingFetch(401, []))
        const withoutToken = new ModelCache(workDirectory, () => null).ensure(tinyModel(true), () => {})
        await expect(withoutToken).rejects.toThrow(
            /accept its licence at https:\/\/huggingface.test\/tiny.*hf auth login/
        )
        vi.stubGlobal('fetch', recordingFetch(403, []))
        const withToken = new ModelCache(workDirectory, () => 'hf_secret').ensure(tinyModel(true), () => {})
        await expect(withToken).rejects.toThrow(/hasn't been given access yet/)
    })

    it('reads HF_TOKEN first, then the token `hf auth login` saved', () => {
        expect(huggingFaceToken({ HF_TOKEN: ' hf_environment ' }, workDirectory)).toBe('hf_environment')
        expect(huggingFaceToken({}, workDirectory)).toBeNull()
        mkdirSync(join(workDirectory, '.cache', 'huggingface'), { recursive: true })
        writeFileSync(join(workDirectory, '.cache', 'huggingface', 'token'), 'hf_saved\n')
        expect(huggingFaceToken({}, workDirectory)).toBe('hf_saved')
    })
})
