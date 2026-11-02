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
export type { CameraTransport } from '#contribute/observe'
export type { CameraContext, Contribution, DiagnosticEntry } from '#contribute/schema'

export interface ConsentStore {
    read(): Promise<boolean | null>
    write(enabled: boolean): Promise<void>
}
export interface ContributionOptions {
    endpoint: string
    /** Obtain a scoped contribution token from the application's server. Never embed cloud credentials. */
    accessToken(): Promise<string>
    consent: ConsentStore
    camera: CameraContext
    /** Honor application/environment opt-outs on every collection and upload operation. */
    disabled?: () => boolean
    fetch?: typeof fetch
    uploadTimeoutMilliseconds?: number
    /** Automatic bounded uploads while the client is open. Default: once per minute. */
    flushIntervalMilliseconds?: number
}

function environmentDisabled() {
    const environment = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    return environment?.DARKGRADE_CONTRIBUTIONS === '0' || environment?.DO_NOT_TRACK === '1'
}

/** Importing this package does nothing. Consent is required before observing or uploading diagnostics. */
export async function createContributions(options: ContributionOptions) {
    const endpoint = new URL(options.endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
        throw new Error('A credential-free HTTPS collector URL is required')
    const base = endpoint.href.replace(/\/$/, '')
    const request = options.fetch ?? globalThis.fetch
    const timeout = options.uploadTimeoutMilliseconds ?? 10_000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) throw new Error('Invalid upload timeout')
    const interval = options.flushIntervalMilliseconds ?? 60_000
    if (!Number.isSafeInteger(interval) || interval < 1000 || interval > 3_600_000)
        throw new Error('Invalid flush interval')
    const camera = structuredClone(options.camera)
    validateContribution({
        schema: SCHEMA,
        disclosure: DISCLOSURE,
        id: crypto.randomUUID(),
        camera,
        entries: [],
        droppedEntries: 0,
    })
    let consent = (await options.consent.read()) === true
    let generation = 0
    let entries: DiagnosticEntry[] = []
    let droppedEntries = 0
    let pending: Contribution | undefined
    let upload: Promise<'sent' | 'disabled' | 'empty' | 'retry' | 'rejected'> | undefined
    let abort: AbortController | undefined
    let closed = false
    let retryAfter = 0
    let consentWrites = Promise.resolve()
    const persist = (value: boolean) => {
        consentWrites = consentWrites.catch(() => {}).then(() => options.consent.write(value))
        return consentWrites
    }
    const enabled = () => {
        try {
            return !closed && consent && !environmentDisabled() && !(options.disabled?.() ?? false)
        } catch {
            return false
        }
    }
    const accessToken = (signal: AbortSignal) =>
        new Promise<string>((resolve, reject) => {
            const cancelled = () => reject(new Error('Token request cancelled'))
            if (signal.aborted) {
                cancelled()
                return
            }
            signal.addEventListener('abort', cancelled, { once: true })
            Promise.resolve()
                .then(() => options.accessToken())
                .then(resolve, reject)
                .finally(() => signal.removeEventListener('abort', cancelled))
        })
    const clear = () => {
        entries = []
        droppedEntries = 0
        pending = undefined
    }
    const record = (entry: DiagnosticEntry) => {
        if (!enabled()) return
        if (entries.length >= MAXIMUM_ENTRIES) {
            droppedEntries++
            return
        }
        entries.push(entry)
    }
    const send = async (): Promise<'sent' | 'disabled' | 'empty' | 'retry' | 'rejected'> => {
        if (!enabled()) {
            clear()
            return 'disabled'
        }
        if (!pending && !entries.length) return 'empty'
        if (Date.now() < retryAfter) return 'retry'
        const epoch = generation
        if (!pending) {
            pending = {
                schema: SCHEMA,
                disclosure: DISCLOSURE,
                id: crypto.randomUUID(),
                camera,
                entries,
                droppedEntries,
            }
            entries = []
            droppedEntries = 0
        }
        try {
            validateContribution(pending)
        } catch {
            pending = undefined
            return 'rejected'
        }
        const body = JSON.stringify(pending)
        if (new TextEncoder().encode(body).length > MAXIMUM_BODY_BYTES) {
            clear()
            throw new Error('Diagnostic size limit exceeded')
        }
        abort = new AbortController()
        const timer = setTimeout(() => abort?.abort(), timeout)
        try {
            const token = await accessToken(abort.signal)
            if (!enabled() || epoch !== generation || abort.signal.aborted) {
                clear()
                return 'disabled'
            }
            const response = await request(`${base}/v1/contributions`, {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body,
                signal: abort.signal,
                redirect: 'error',
                credentials: 'omit',
            })
            if (!enabled() || epoch !== generation) {
                clear()
                return 'disabled'
            }
            if (response.status === 403 || response.status === 410) {
                consent = false
                clear()
                await persist(false)
                return 'disabled'
            }
            if ([400, 404, 405, 413, 415, 422].includes(response.status)) {
                pending = undefined
                return 'rejected'
            }
            if (!response.ok) {
                const seconds = Number(response.headers.get('retry-after'))
                if (Number.isFinite(seconds) && seconds > 0) retryAfter = Date.now() + Math.min(seconds, 86400) * 1000
                return 'retry'
            }
            pending = undefined
            return 'sent'
        } catch {
            return enabled() && epoch === generation ? 'retry' : 'disabled'
        } finally {
            clearTimeout(timer)
            abort = undefined
        }
    }
    const flush = () =>
        (upload ??= send().finally(() => {
            upload = undefined
        }))
    const timer = setInterval(() => {
        void flush().catch(() => {})
    }, interval)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    return {
        enabled,
        observe<Device, Kind extends string>(source: CameraTransport<Device, Kind>) {
            return observeTransport(source, enabled, record, () => generation)
        },
        status: () => ({
            enabled: enabled(),
            queuedEntries: entries.length + (pending?.entries.length ?? 0),
            droppedEntries,
        }),
        flush,
        async setConsent(value: boolean) {
            const epoch = ++generation
            consent = false
            abort?.abort()
            clear()
            await persist(value)
            if (epoch === generation && !closed) consent = value
        },
        /** Stops collection immediately, then revokes the token and deletes this contributor's cloud data.
         * If deletion fails, remain opted out and retry this method; never silently re-enable. */
        async optOut() {
            generation++
            consent = false
            abort?.abort()
            clear()
            let persistenceFailed = false
            try {
                await persist(false)
            } catch {
                persistenceFailed = true
            }
            const signal = AbortSignal.timeout(timeout)
            const token = await accessToken(signal)
            const response = await request(`${base}/v1/contributions`, {
                method: 'DELETE',
                headers: { authorization: `Bearer ${token}` },
                signal,
                redirect: 'error',
                credentials: 'omit',
            })
            if (!response.ok) throw new Error('Opted out locally; cloud deletion must be retried')
            if (persistenceFailed) throw new Error('Cloud consent withdrawn; saving the local opt-out must be retried')
        },
        close() {
            closed = true
            generation++
            consent = false
            abort?.abort()
            clearInterval(timer)
            clear()
        },
    }
}
