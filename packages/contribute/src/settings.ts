import {
    createApplicationDiagnostics,
    validateInstallationState,
    type InstallationState,
    type InstallationStore,
} from '#contribute/application'
import { NOTICE_VERSION } from '#contribute/batch'
import type { CameraContext, DiagnosticEntry } from '#contribute/schema'
import { randomBytes, randomUUID } from 'node:crypto'
import {
    appendFileSync,
    closeSync,
    existsSync,
    fsyncSync,
    mkdirSync,
    openSync,
    readdirSync,
    readFileSync,
    renameSync,
    statSync,
    unlinkSync,
    writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const settingsDirectory = () => process.env.DARKGRADE_HOME || join(homedir(), '.darkgrade')
export function sharedSettings(directory = settingsDirectory()): InstallationStore {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, 'settings.json')
    let previous: InstallationState | null = null
    const read = () => {
        if (!existsSync(file)) return null
        if (statSync(file).size > 16_384) throw new Error('Invalid telemetry settings')
        const state = JSON.parse(readFileSync(file, 'utf8'))
        validateInstallationState(state)
        return state as InstallationState
    }
    const locked = async <T>(work: () => T): Promise<T> => {
        // Serialize simultaneous CLI/Studio startup; never steal a potentially live writer's lock.
        let lock: number | undefined
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                lock = openSync(`${file}.lock`, 'wx', 0o600)
                break
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
                await new Promise(resolve => setTimeout(resolve, 5 + Math.random() * 5))
            }
        }
        if (lock === undefined) throw new Error('Telemetry settings are locked; another process may be updating them')
        try {
            return work()
        } finally {
            closeSync(lock)
            unlinkSync(`${file}.lock`)
        }
    }
    const save = (state: InstallationState) => {
        validateInstallationState(state)
        const temporary = `${file}.${randomUUID()}.tmp`
        const descriptor = openSync(temporary, 'wx', 0o600)
        try {
            writeFileSync(descriptor, JSON.stringify(state, null, 2) + '\n')
            fsyncSync(descriptor)
        } finally {
            closeSync(descriptor)
        }
        try {
            renameSync(temporary, file)
        } finally {
            if (existsSync(temporary)) unlinkSync(temporary)
        }
        const parent = openSync(directory, 'r')
        try {
            fsyncSync(parent)
        } finally {
            closeSync(parent)
        }
        previous = structuredClone(state)
    }
    return {
        async read() {
            return locked(() => {
                previous = read()
                if (!previous) {
                    const installationId = randomUUID()
                    previous = {
                        enabled: true,
                        withdrawalPending: false,
                        noticeVersion: NOTICE_VERSION,
                        installationId,
                        enrollmentKey: `dgi_${installationId}.${randomBytes(32).toString('base64url')}`,
                    }
                    save(previous)
                }
                return structuredClone(previous)
            })
        },
        async write(state) {
            await locked(() => {
                const current = read()
                const merged = { ...current } as InstallationState
                for (const key of new Set([...Object.keys(previous ?? {}), ...Object.keys(state)])) {
                    const before = (previous as any)?.[key],
                        next = (state as any)[key],
                        present = (current as any)?.[key]
                    if (before === next) continue
                    if (present !== before && present !== next)
                        throw new Error('Telemetry settings changed in another process; reload before updating')
                    if (next === undefined) delete (merged as any)[key]
                    else (merged as any)[key] = next
                }
                save(merged)
                // Compare future writes to what this caller requested, not another process's
                // merged preference. Repeated stale enrollment writes must preserve an opt-out.
                previous = structuredClone(state)
            })
        },
        current: read,
    }
}

/** Per-process rotation avoids cross-process append/rotation races. No payloads or arbitrary logs. */
export function localDiagnostics(directory = settingsDirectory()) {
    const folder = join(directory, 'diagnostics')
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    const files = readdirSync(folder)
        .filter(name => /^\d+\.jsonl(?:\.previous)?$/.test(name))
        .map(name => ({ name, time: statSync(join(folder, name)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
    for (const file of files.slice(24)) {
        // Never delete a live process's files while it is writing.
        const pid = Number(file.name.split('.')[0])
        try {
            process.kill(pid, 0)
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ESRCH') unlinkSync(join(folder, file.name))
        }
    }
    const file = join(folder, `${process.pid}.jsonl`)
    let buffered: string[] = []
    const flush = () => {
        if (!buffered.length) return
        const text = buffered.join('')
        buffered = []
        try {
            if (existsSync(file) && statSync(file).size + Buffer.byteLength(text) > 2 * 1024 * 1024)
                renameSync(file, `${file}.previous`)
            appendFileSync(file, text, { mode: 0o600 })
        } catch {
            /* Camera operations remain available if local diagnostics fail. */
        }
    }
    const timer = setInterval(flush, 1000)
    timer.unref()
    return {
        record(camera: CameraContext, entry: DiagnosticEntry) {
            if (process.env.DARKGRADE_LOCAL_DIAGNOSTICS === '0') return
            if (buffered.length >= 1000) return
            buffered.push(JSON.stringify({ camera, ...entry }) + '\n')
        },
        close() {
            clearInterval(timer)
            flush()
        },
    }
}

let shared: Promise<Awaited<ReturnType<typeof createApplicationDiagnostics>>> | undefined
let log: ReturnType<typeof localDiagnostics> | undefined
let shutdownHooks = false
/** One queue and identity shared by all Link cameras in this process; CLI and Studio use the same file. */
export function nodeDiagnostics() {
    return (shared ??= (async () => {
        if (!shutdownHooks) {
            shutdownHooks = true
            // Short-lived CLI/bench tools must not discard their queue merely because the
            // periodic uploader is unref'd. Forced exits still retain buffered local metadata.
            process.once('exit', () => log?.close())
            process.once('beforeExit', () => {
                void flushNodeDiagnostics()
                    .finally(closeNodeDiagnostics)
                    .catch(() => {})
            })
        }
        log = localDiagnostics()
        return createApplicationDiagnostics({
            // No upload is possible until the real deployment origin is configured.
            endpoint: process.env.DARKGRADE_TELEMETRY_URL || 'https://telemetry.invalid',
            disabled: () => !process.env.DARKGRADE_TELEMETRY_URL,
            store: sharedSettings(),
            localRecord: log.record,
        })
    })().catch(error => {
        shared = undefined
        log?.close()
        throw error
    }))
}
/** Bounded final delivery for process owners; never used on the camera-operation path. */
export async function flushNodeDiagnostics() {
    if (!shared) return 'empty'
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        return await Promise.race([
            shared.then(client => client.flush()),
            new Promise<'timeout'>(resolve => {
                timer = setTimeout(() => resolve('timeout'), 3000)
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
    }
}
export async function closeNodeDiagnostics() {
    if (shared) (await shared).close()
    log?.close()
    shared = undefined
    log = undefined
}
