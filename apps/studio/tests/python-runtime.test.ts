import { PythonRuntime } from '@main/voice/python-runtime'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let workDirectory: string

beforeEach(() => {
    workDirectory = mkdtempSync(join(tmpdir(), 'python-runtime-'))
})
afterEach(() => rmSync(workDirectory, { recursive: true, force: true }))

/** A tiny tar.gz laid out like python-build-standalone's: python/bin/python3.11. */
function fakePythonArchive(): Buffer {
    const source = join(workDirectory, 'source')
    mkdirSync(join(source, 'python', 'bin'), { recursive: true })
    writeFileSync(join(source, 'python', 'bin', 'python3.11'), '#!/bin/sh\necho Python 3.11\n', { mode: 0o755 })
    const archivePath = join(workDirectory, 'fake.tar.gz')
    execFileSync('tar', ['-czf', archivePath, '-C', source, 'python'])
    return readFileSync(archivePath)
}

function serving(archive: Buffer, requests: string[]): typeof fetch {
    return (async (url: string) => {
        requests.push(url)
        return new Response(new Uint8Array(archive))
    }) as unknown as typeof fetch
}

describe('python runtime', () => {
    it('downloads its own Python rather than using one on the Mac, reporting progress', async () => {
        const archive = fakePythonArchive()
        const requests: string[] = []
        const progress: number[] = []
        const runtime = new PythonRuntime({
            directory: join(workDirectory, 'runtime'),
            archive: {
                url: 'https://example.test/python.tar.gz',
                bytes: archive.length,
                sha256: createHash('sha256').update(archive).digest('hex'),
            },
            fetchArchive: serving(archive, requests),
        })
        const pythonPath = await runtime.ensure(update => progress.push(update.receivedBytes))
        expect(pythonPath).toBe(join(workDirectory, 'runtime', 'python', 'bin', 'python3.11'))
        expect(execFileSync(pythonPath).toString()).toContain('Python 3.11')
        expect(progress.at(-1)).toBe(archive.length)

        await runtime.ensure(() => {})
        expect(requests).toHaveLength(1)
        expect(runtime.identity).toBe(createHash('sha256').update(archive).digest('hex'))
    })

    it('refuses a download that does not match the pinned checksum', async () => {
        const archive = fakePythonArchive()
        const runtime = new PythonRuntime({
            directory: join(workDirectory, 'runtime'),
            archive: { url: 'https://example.test/python.tar.gz', bytes: archive.length, sha256: '0'.repeat(64) },
            fetchArchive: serving(archive, []),
        })
        await expect(runtime.ensure(() => {})).rejects.toThrow('damaged or changed')
    })
})
