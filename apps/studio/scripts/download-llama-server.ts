/**
 * Downloads the pinned llama.cpp release for Apple Silicon and keeps only llama-server and the
 * libraries it loads. Studio runs it as a background process for local AI (live transcription).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync, cpSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const LLAMA_CPP_RELEASE = 'b12283'
const ARCHIVE_NAME = `llama-${LLAMA_CPP_RELEASE}-bin-macos-arm64.tar.gz`
const ARCHIVE_URL = `https://github.com/ggml-org/llama.cpp/releases/download/${LLAMA_CPP_RELEASE}/${ARCHIVE_NAME}`

const outputDirectory = resolve(import.meta.dirname, '..', 'resources', 'llama-server')
const versionFile = join(outputDirectory, 'VERSION')

function isCurrent(): boolean {
    if (!existsSync(versionFile)) return false
    return execFileSync('cat', [versionFile]).toString().trim() === LLAMA_CPP_RELEASE
}

async function main(): Promise<void> {
    if (process.platform !== 'darwin' || process.arch !== 'arm64') {
        console.log('[llama-server] skipped: only Apple Silicon is supported')
        return
    }
    if (isCurrent()) return

    const workDirectory = join(tmpdir(), `darkgrade-llama-${LLAMA_CPP_RELEASE}`)
    rmSync(workDirectory, { recursive: true, force: true })
    mkdirSync(workDirectory, { recursive: true })

    console.log(`[llama-server] downloading ${ARCHIVE_NAME}`)
    const response = await fetch(ARCHIVE_URL)
    if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
    const archivePath = join(workDirectory, ARCHIVE_NAME)
    writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()))
    execFileSync('tar', ['-xzf', archivePath, '-C', workDirectory])

    const extracted = join(workDirectory, `llama-${LLAMA_CPP_RELEASE}`)
    rmSync(outputDirectory, { recursive: true, force: true })
    mkdirSync(outputDirectory, { recursive: true })
    for (const name of readdirSync(extracted)) {
        const otherToolLibrary = name.endsWith('-impl.dylib') && name !== 'libllama-server-impl.dylib'
        const keep = name === 'llama-server' || name === 'LICENSE' || (name.endsWith('.dylib') && !otherToolLibrary)
        if (keep) cpSync(join(extracted, name), join(outputDirectory, name), { verbatimSymlinks: true })
    }
    writeFileSync(versionFile, `${LLAMA_CPP_RELEASE}\n`)
    rmSync(workDirectory, { recursive: true, force: true })
    console.log(`[llama-server] ready in ${outputDirectory}`)
}

await main()
