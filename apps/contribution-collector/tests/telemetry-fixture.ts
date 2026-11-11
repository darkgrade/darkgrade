import { BATCH_SCHEMA, NOTICE_VERSION } from '@darkgrade/contribute/batch'
import { DISCLOSURE, SCHEMA } from '@darkgrade/contribute/schema'
import { randomUUID } from 'node:crypto'
import type { Database, Row } from '../src/database.ts'

export function memoryDatabase() {
    const records = new Map<string, Record<string, any>>()
    let tail = Promise.resolve(),
        failDeletes = false
    const database: Database = {
        get: async path => structuredClone(records.get(path)),
        async transaction(work) {
            let release!: () => void
            const previous = tail
            tail = new Promise<void>(resolve => {
                release = resolve
            })
            await previous
            try {
                const copy = structuredClone(records)
                const result = await work({
                    get: async path => structuredClone(copy.get(path)),
                    set: (path, data) => {
                        copy.set(path, structuredClone(data))
                    },
                    delete: path => {
                        if (failDeletes) throw new Error('Storage interrupted')
                        copy.delete(path)
                    },
                })
                records.clear()
                for (const [key, value] of copy) records.set(key, value)
                return result
            } finally {
                release()
            }
        },
        async list(collection, field, value, after) {
            return [...records]
                .filter(
                    ([path, data]) =>
                        path.startsWith(collection + '/') &&
                        (!field || data[field] === value) &&
                        (!after || path > after)
                )
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(0, 100)
                .map(([path, data]): Row => ({ path, data: structuredClone(data) }))
        },
    }
    return {
        database,
        records,
        failDeletes: (value: boolean) => {
            failDeletes = value
        },
    }
}
export const camera = {
    manufacturer: 'Canon',
    model: 'EOS R6 Mark III',
    firmware: '1.0',
    revision: '9712503',
    dirty: false,
    transport: 'usb' as const,
    evidence: 'synthetic' as const,
}
export function batch() {
    return {
        schema: BATCH_SCHEMA,
        id: randomUUID(),
        contributions: [
            {
                schema: SCHEMA,
                disclosure: DISCLOSURE,
                id: randomUUID(),
                camera: structuredClone(camera),
                entries: [
                    {
                        kind: 'command',
                        direction: 'out',
                        code: 0x1001,
                        bytes: 12,
                        durationMilliseconds: 1,
                        failed: false,
                    },
                ],
                droppedEntries: 0,
            },
        ],
    }
}
export async function enroll(handle: (request: Request) => Promise<Response>) {
    const response = await handle(
        new Request('https://telemetry.example/v2/installations', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ noticeVersion: NOTICE_VERSION }),
        })
    )
    if (response.status !== 201) throw new Error('Enrollment failed')
    return response.json() as Promise<{ installId: string; installKey: string }>
}
export function request(
    path: string,
    method: string,
    key?: string,
    body?: unknown,
    headers: Record<string, string> = {}
) {
    return new Request('https://telemetry.example' + path, {
        method,
        headers: {
            ...(key && { authorization: `Bearer ${key}` }),
            ...(body !== undefined && { 'content-type': 'application/json' }),
            ...headers,
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
    })
}
