export type Row = { path: string; data: Record<string, any> }
export interface Transaction {
    get(path: string): Promise<Record<string, any> | undefined>
    set(path: string, data: Record<string, any>): void
    delete(path: string): void
}
export interface Database {
    transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>
    get(path: string): Promise<Record<string, any> | undefined>
    list(collection: string, field?: string, value?: unknown, after?: string): Promise<Row[]>
}

type Value = Record<string, any>
function encode(value: any): Value {
    if (value === null) return { nullValue: null }
    if (value instanceof Date) return { timestampValue: value.toISOString() }
    if (typeof value === 'string') return { stringValue: value }
    if (typeof value === 'boolean') return { booleanValue: value }
    if (typeof value === 'number' && Number.isFinite(value))
        return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
    if (value && typeof value === 'object') return { mapValue: { fields: fields(value) } }
    throw new Error('Invalid database value')
}
const fields = (value: Record<string, any>) =>
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]))
function decode(value: Value): any {
    if ('nullValue' in value) return null
    if ('timestampValue' in value) return new Date(value.timestampValue)
    if ('integerValue' in value) return Number(value.integerValue)
    if ('doubleValue' in value) return value.doubleValue
    if ('booleanValue' in value) return value.booleanValue
    if ('stringValue' in value) return value.stringValue
    if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode)
    if ('mapValue' in value) return fromFields(value.mapValue.fields)
    throw new Error('Invalid Firestore value')
}
const fromFields = (value: Record<string, Value> = {}) =>
    Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))

/** Workload identity in production; the emulator is an explicit loopback-only test option. */
export function firestoreDatabase(
    project: string,
    options: { request?: typeof fetch; emulator?: string; accessToken?: (refresh?: boolean) => Promise<string> } = {}
): Database {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('Invalid Firestore project')
    if (options.emulator && !/^(localhost|127\.0\.0\.1):\d+$/.test(options.emulator))
        throw new Error('Firestore emulator must be loopback')
    const request = options.request ?? fetch
    const database = `projects/${project}/databases/(default)`
    const documentRoot = `${database}/documents`
    const origin = options.emulator ? `http://${options.emulator}` : 'https://firestore.googleapis.com'
    let token: { value: string; expires: number } | undefined
    const credential = async (refresh = false) => {
        if (options.emulator) return 'owner'
        if (options.accessToken) return options.accessToken(refresh)
        if (refresh) token = undefined
        if (token && token.expires > Date.now() + 60_000) return token.value
        const result = await request(
            'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
            {
                headers: { 'Metadata-Flavor': 'Google' },
                signal: AbortSignal.timeout(5000),
                redirect: 'error',
            }
        )
        if (!result.ok) throw new Error('Workload identity unavailable')
        const data = (await result.json()) as { access_token: string; expires_in: number }
        if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Invalid workload identity')
        token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
        return token.value
    }
    const call = async (suffix: string, body?: unknown) => {
        const send = async (refresh: boolean) =>
            request(`${origin}/v1/${documentRoot}${suffix}`, {
                method: body === undefined ? 'GET' : 'POST',
                headers: { authorization: `Bearer ${await credential(refresh)}`, 'content-type': 'application/json' },
                ...(body !== undefined && { body: JSON.stringify(body) }),
                redirect: 'error',
                signal: AbortSignal.timeout(15_000),
            })
        const response = await send(false)
        if (response.status !== 401) return response
        await response.body?.cancel()
        return send(true)
    }
    const checkedPath = (path: string) => {
        if (!/^[\w-]+\/[\w.-]+$/.test(path)) throw new Error('Invalid document path')
        return `${documentRoot}/${path}`
    }
    const read = async (path: string) => {
        checkedPath(path)
        const response = await call(`/${path}`)
        if (response.status === 404) return undefined
        if (!response.ok) throw new Error('Firestore read unavailable')
        return fromFields(((await response.json()) as any).fields)
    }
    return {
        get: read,
        async transaction<T>(work: (transaction: Transaction) => Promise<T>): Promise<T> {
            for (let attempt = 0; attempt < 6; attempt++) {
                const reads = new Map<string, { data: Record<string, any> | undefined; condition: object }>()
                const writes = new Map<string, any>()
                const value = await work({
                    async get(path) {
                        checkedPath(path)
                        if (reads.has(path)) return structuredClone(reads.get(path)!.data)
                        const result = await call(`/${path}`)
                        if (!result.ok && result.status !== 404) throw new Error('Firestore transaction read failed')
                        const document = result.status === 404 ? undefined : ((await result.json()) as any)
                        if (document && (!document.updateTime || document.name !== checkedPath(path)))
                            throw new Error('Invalid Firestore document version')
                        const data = document ? fromFields(document.fields) : undefined
                        reads.set(path, {
                            data,
                            condition: document ? { updateTime: document.updateTime } : { exists: false },
                        })
                        return structuredClone(data)
                    },
                    set: (path, data) => {
                        writes.set(path, { update: { name: checkedPath(path), fields: fields(data) } })
                    },
                    delete: path => {
                        writes.set(path, { delete: checkedPath(path) })
                    },
                })
                // Atomically verify every read, including read-only ownership/revocation guards.
                // This avoids server-held read locks across HTTP requests and prevents write skew.
                for (const [path, read] of reads) {
                    const write = writes.get(path) ?? { verify: checkedPath(path) }
                    writes.set(path, { ...write, currentDocument: read.condition })
                }
                if (writes.size > 450) throw new Error('Transaction too large')
                const committed = await call(':commit', { writes: [...writes.values()] })
                const failure = committed.ok ? undefined : ((await committed.json().catch(() => undefined)) as any)
                if (
                    [409, 412].includes(committed.status) ||
                    ['ABORTED', 'FAILED_PRECONDITION'].includes(failure?.error?.status)
                ) {
                    await new Promise(resolve => setTimeout(resolve, Math.random() * 40 * 2 ** attempt))
                    continue
                }
                if (!committed.ok) throw new Error('Firestore commit failed')
                await committed.body?.cancel()
                return value
            }
            throw new Error('Firestore transaction contended')
        },
        async list(collection, field, value, after) {
            if (!/^[\w-]+$/.test(collection) || (field && !/^[\w]+$/.test(field))) throw new Error('Invalid query')
            const response = await call(':runQuery', {
                structuredQuery: {
                    from: [{ collectionId: collection }],
                    ...(field && {
                        where: { fieldFilter: { field: { fieldPath: field }, op: 'EQUAL', value: encode(value) } },
                    }),
                    orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }],
                    ...(after && { startAt: { before: false, values: [{ referenceValue: checkedPath(after) }] } }),
                    limit: 100,
                },
            })
            if (!response.ok) throw new Error('Firestore query unavailable')
            const rows = (await response.json()) as any[]
            if (!Array.isArray(rows)) throw new Error('Invalid query result')
            return rows
                .filter(row => row.document)
                .map(({ document }) => {
                    const path = document.name.slice(documentRoot.length + 1)
                    if (!path.startsWith(`${collection}/`) || checkedPath(path) !== document.name)
                        throw new Error('Invalid query scope')
                    return { path, data: fromFields(document.fields) }
                })
        },
    }
}
