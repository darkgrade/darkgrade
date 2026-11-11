import {
    BATCH_SCHEMA,
    DIAGNOSTICS_NOTICE,
    MAXIMUM_BATCH_CAMERAS,
    NOTICE_VERSION,
    validateBatch,
    type DiagnosticBatch,
} from '#contribute/batch'
import { observeTransport, type CameraTransport } from '#contribute/observe'
import {
    DISCLOSURE,
    MAXIMUM_BODY_BYTES,
    MAXIMUM_ENTRIES,
    SCHEMA,
    validateContribution,
    type CameraContext,
    type Contribution,
    type DiagnosticEntry,
} from '#contribute/schema'

export interface InstallationState {
    enabled: boolean
    noticeVersion: string
    installKey?: string
    collectorOrigin?: string
    withdrawalPending: boolean
}
/** The application must store credentials securely and serialize access across its own processes. */
export interface InstallationStore {
    read(): Promise<InstallationState | null>
    write(state: InstallationState): Promise<void>
}
export interface ApplicationDiagnosticsOptions {
    endpoint: string
    store: InstallationStore
    /** Display the notice before the first observation; a visible setting must remain available. */
    presentNotice(notice: { text: string; version: string }): Promise<void | boolean>
    disabled?: () => boolean
    fetch?: typeof fetch
    flushIntervalMilliseconds?: number
    requestTimeoutMilliseconds?: number
}
type FlushResult = 'sent' | 'empty' | 'disabled' | 'retry' | 'rejected'
const keyPattern = /^dgi_[a-f0-9-]{36}\.[A-Za-z0-9_-]{43}$/
export function validateInstallationState(state: unknown): asserts state is InstallationState {
    const value = state as InstallationState
    if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).some(
            key => !['enabled', 'noticeVersion', 'installKey', 'collectorOrigin', 'withdrawalPending'].includes(key)
        ) ||
        typeof value.enabled !== 'boolean' ||
        typeof value.noticeVersion !== 'string' ||
        typeof value.withdrawalPending !== 'boolean' ||
        (value.installKey !== undefined && !keyPattern.test(value.installKey)) ||
        (value.collectorOrigin !== undefined && typeof value.collectorOrigin !== 'string')
    )
        throw new Error('Invalid diagnostics settings; restore preferences before enabling collection')
}
function environmentDisabled() {
    const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    return environment?.DARKGRADE_CONTRIBUTIONS === '0' || environment?.DO_NOT_TRACK === '1'
}

/** Create once per application process and observe every camera through this shared queue. */
export async function createApplicationDiagnostics(options: ApplicationDiagnosticsOptions) {
    const url = new URL(options.endpoint)
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
        throw new Error('A credential-free HTTPS collector origin is required')
    const interval = options.flushIntervalMilliseconds ?? 300_000
    const timeout = options.requestTimeoutMilliseconds ?? 10_000
    if (
        !Number.isSafeInteger(interval) ||
        interval < 1000 ||
        interval > 3_600_000 ||
        !Number.isSafeInteger(timeout) ||
        timeout < 1 ||
        timeout > 60_000
    )
        throw new Error('Invalid diagnostics timing')
    const request = options.fetch ?? fetch
    const saved = await options.store.read()
    if (saved !== null) validateInstallationState(saved)
    let state: InstallationState = saved
        ? structuredClone(saved)
        : { enabled: true, noticeVersion: '', withdrawalPending: false }
    if (state.installKey && state.collectorOrigin !== url.origin)
        throw new Error('Installation credential belongs to another collector')
    state.collectorOrigin = url.origin
    if (state.noticeVersion !== NOTICE_VERSION) {
        const choice = await options.presentNotice({ text: DIAGNOSTICS_NOTICE, version: NOTICE_VERSION })
        if (choice === false) state.enabled = false
        state.noticeVersion = NOTICE_VERSION
        await options.store.write(structuredClone(state))
    }
    let closed = false,
        epoch = 0,
        count = 0,
        dropped = 0,
        retryAt = 0
    let storageError = false,
        lastError: string | null = null
    const queue = new Map<string, Contribution>()
    let pending: DiagnosticBatch | undefined
    let inFlight: Promise<FlushResult> | undefined
    let withdrawal: Promise<void> | undefined
    let writes = Promise.resolve()
    const requests = new Set<AbortController>()
    const persist = (value = state) => {
        const snapshot = structuredClone(value)
        const write = writes.catch(() => {}).then(() => options.store.write(snapshot))
        writes = write.catch(error => {
            storageError = true
            state.enabled = false
            lastError = 'Saving diagnostics preferences failed'
            throw error
        })
        return writes
    }
    const enabled = () => {
        try {
            return (
                !closed &&
                !storageError &&
                state.enabled &&
                !state.withdrawalPending &&
                !environmentDisabled() &&
                !(options.disabled?.() ?? false)
            )
        } catch {
            return false
        }
    }
    const clear = () => {
        queue.clear()
        count = 0
        pending = undefined
        dropped = 0
    }
    const cancel = () => {
        for (const controller of requests) controller.abort()
        clear()
    }
    const call = async (path: string, method: string, body?: unknown, key?: string) => {
        const controller = new AbortController()
        requests.add(controller)
        const timer = setTimeout(() => controller.abort(), timeout)
        try {
            const response = await request(`${url.origin}${path}`, {
                method,
                headers: {
                    ...(body !== undefined && { 'content-type': 'application/json' }),
                    ...(key && { authorization: `Bearer ${key}` }),
                },
                ...(body !== undefined && { body: JSON.stringify(body) }),
                signal: controller.signal,
                redirect: 'error',
                credentials: 'omit',
            })
            const reader = response.body?.getReader()
            if (!reader) throw new Error('Empty telemetry response')
            const chunks: Uint8Array[] = []
            let length = 0
            try {
                for (;;) {
                    const item = await reader.read()
                    if (item.done) break
                    length += item.value.length
                    if (length > 32_768) throw new Error('Oversized telemetry response')
                    chunks.push(item.value)
                }
            } finally {
                await reader.cancel().catch(() => {})
                reader.releaseLock()
            }
            const bytes = new Uint8Array(length)
            let offset = 0
            for (const chunk of chunks) {
                bytes.set(chunk, offset)
                offset += chunk.length
            }
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
            let data: any
            try {
                data = JSON.parse(text)
            } catch {
                throw new Error('Invalid telemetry response')
            }
            return { response, data }
        } finally {
            clearTimeout(timer)
            requests.delete(controller)
        }
    }
    const enroll = async (generation: number) => {
        if (state.installKey) return state.installKey
        const { response, data } = await call('/v2/installations', 'POST', { noticeVersion: NOTICE_VERSION })
        if (!response.ok || !keyPattern.test(data.installKey) || data.noticeVersion !== NOTICE_VERSION)
            throw new Error('Diagnostics enrollment unavailable')
        if (generation !== epoch || !enabled()) return undefined
        state.installKey = data.installKey
        await persist() // Never upload with an identity the application cannot retain for withdrawal.
        if (generation !== epoch || !enabled()) return undefined
        return state.installKey
    }
    const send = async (): Promise<FlushResult> => {
        if (!enabled()) {
            clear()
            return 'disabled'
        }
        if (!pending && !count) return 'empty'
        if (Date.now() < retryAt) return 'retry'
        const generation = epoch
        if (!pending) {
            pending = { schema: BATCH_SCHEMA, id: crypto.randomUUID(), contributions: [...queue.values()] }
            queue.clear()
            count = 0
        }
        const batch = pending
        try {
            validateBatch(batch)
            if (new TextEncoder().encode(JSON.stringify(batch)).length > MAXIMUM_BODY_BYTES)
                throw new Error('Diagnostic batch too large')
        } catch {
            pending = undefined
            return 'rejected'
        }
        try {
            const key = await enroll(generation)
            if (!key || generation !== epoch || !enabled()) return 'disabled'
            const { response } = await call('/v2/batches', 'POST', batch, key)
            if (generation !== epoch || !enabled()) return 'disabled'
            if ([401, 403, 410].includes(response.status)) {
                state.enabled = false
                clear()
                lastError = 'Diagnostics enrollment is no longer active'
                await persist()
                return 'disabled'
            }
            if ([400, 404, 405, 409, 413, 415, 422].includes(response.status)) {
                pending = undefined
                lastError = 'Collector rejected this diagnostic batch'
                return 'rejected'
            }
            if (!response.ok) {
                const seconds = Number(response.headers.get('retry-after'))
                retryAt =
                    Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86_400) * 1000 : 60_000)
                lastError = 'Upload will retry'
                return 'retry'
            }
            pending = undefined
            lastError = null
            return 'sent'
        } catch {
            lastError = storageError ? lastError : 'Upload will retry'
            retryAt = Date.now() + 60_000
            return enabled() && generation === epoch ? 'retry' : 'disabled'
        }
    }
    const flush = () =>
        (inFlight ??= send().finally(() => {
            inFlight = undefined
        }))
    const retryWithdrawal = () =>
        (withdrawal ??= (async () => {
            if (!state.withdrawalPending || closed) return
            await writes.catch(() => {})
            const key = state.installKey
            if (!key) {
                const next = { ...state, withdrawalPending: false }
                await persist(next)
                state = next
                lastError = null
                return
            }
            const { response, data } = await call('/v2/installation', 'DELETE', undefined, key)
            if (!response.ok || data.revoked !== true) throw new Error('Withdrawal must be retried')
            const next = { ...state, withdrawalPending: data.deletionPending !== false }
            if (!next.withdrawalPending) delete next.installKey
            await persist(next)
            state = next
            lastError = state.withdrawalPending ? 'Deletion pending; the service will retry' : null
        })()
            .catch(error => {
                lastError = 'Withdrawal must be retried'
                throw error
            })
            .finally(() => {
                withdrawal = undefined
            }))
    const timer = setInterval(() => {
        if (state.withdrawalPending) void retryWithdrawal().catch(() => {})
        else void flush().catch(() => {})
    }, interval)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    if (state.withdrawalPending) void retryWithdrawal().catch(() => {})
    const contactCall = async (method: string, body?: unknown) => {
        if (closed || !state.installKey || state.withdrawalPending)
            throw new Error('No active diagnostics installation')
        const { response, data } = await call('/v2/contact', method, body, state.installKey)
        if (!response.ok) throw new Error('Contact request failed; retry in the diagnostics settings')
        return data
    }
    return {
        enabled,
        status: () => ({
            enabled: enabled(),
            enrolled: !!state.installKey,
            withdrawalPending: state.withdrawalPending,
            queuedEntries:
                count + (pending?.contributions.reduce((sum, camera) => sum + camera.entries.length, 0) ?? 0),
            droppedEntries: dropped,
            error: lastError,
        }),
        observe<Device, Kind extends string>(source: CameraTransport<Device, Kind>, context: CameraContext) {
            const camera = structuredClone(context)
            validateContribution({
                schema: SCHEMA,
                disclosure: DISCLOSURE,
                id: crypto.randomUUID(),
                camera,
                entries: [],
                droppedEntries: 0,
            })
            const group = JSON.stringify(camera)
            return observeTransport(
                source,
                enabled,
                (entry: DiagnosticEntry) => {
                    if (count >= MAXIMUM_ENTRIES || (!queue.has(group) && queue.size >= MAXIMUM_BATCH_CAMERAS)) {
                        dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1)
                        const previous = queue.get(group)
                        if (previous)
                            previous.droppedEntries = Math.min(Number.MAX_SAFE_INTEGER, previous.droppedEntries + 1)
                        return
                    }
                    let contribution = queue.get(group)
                    if (!contribution) {
                        contribution = {
                            schema: SCHEMA,
                            disclosure: DISCLOSURE,
                            id: crypto.randomUUID(),
                            camera,
                            entries: [],
                            droppedEntries: 0,
                        }
                        queue.set(group, contribution)
                    }
                    contribution.entries.push(entry)
                    count++
                },
                () => epoch
            )
        },
        flush,
        async setConsent(value: boolean) {
            if (typeof value !== 'boolean') throw new Error('Diagnostics preference must be boolean')
            if (value && state.withdrawalPending) throw new Error('Finish withdrawal before enrolling again')
            const generation = ++epoch
            state.enabled = false
            cancel()
            const next = { ...state, enabled: value }
            await persist(next)
            if (generation !== epoch || closed) return
            state = next
            storageError = false
            lastError = null
        },
        async withdraw() {
            epoch++
            state.enabled = false
            state.withdrawalPending = true
            cancel()
            // A local storage failure must not prevent revoking the server-side credential.
            let failure: unknown
            try {
                await persist()
            } catch (error) {
                failure = error
            }
            await retryWithdrawal()
            if (failure) throw failure
        },
        retryWithdrawal,
        requestContact: (email: string, credit?: { name: string; publish: true }) =>
            contactCall('POST', { email, ...(credit && { credit }) }),
        removeContact: () => contactCall('DELETE'),
        async contactStatus() {
            if (!state.installKey || closed) return null
            const { response, data } = await call('/v2/installation', 'GET', undefined, state.installKey)
            if (!response.ok) throw new Error('Contact status unavailable')
            return data.contact as {
                email: string
                verified: true
                credit: { name: string; publish: true } | null
            } | null
        },
        close() {
            closed = true
            epoch++
            cancel()
            clearInterval(timer)
        },
    }
}
