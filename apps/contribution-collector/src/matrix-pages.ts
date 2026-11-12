import type { Database } from '#collector/database'
import { createHash } from 'node:crypto'

interface Cursor {
    generation: string
    generatedAt: string
    after: string
    index: number
}
export class MatrixExportChanged extends Error {}
export class InvalidMatrixCursor extends Error {}
const generation = async (database: Database) =>
    (await database.get('maintenance/matrix-generation'))?.value ?? 'initial'

/** Bounded pages; a generation change forces a fresh export, never a mixed snapshot. */
export async function exportMatrixPage(database: Database, cursor?: string, now = new Date()) {
    const current = await generation(database)
    let state: Cursor = { generation: current, generatedAt: now.toISOString(), after: '', index: 0 }
    if (cursor) {
        try {
            if (cursor.length > 800 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
            state = JSON.parse(Buffer.from(cursor, 'base64url').toString())
            if (
                Object.keys(state).sort().join(',') !== 'after,generatedAt,generation,index' ||
                !/^(initial|[a-f0-9-]{36})$/.test(state.generation) ||
                !/^reviewedPatterns\/[a-f0-9-]{36}_[a-f0-9-]{36}$/.test(state.after) ||
                !Number.isSafeInteger(state.index) ||
                state.index < 1 ||
                new Date(state.generatedAt).toISOString() !== state.generatedAt
            )
                throw new Error()
        } catch {
            throw new InvalidMatrixCursor('Invalid Matrix cursor')
        }
    }
    const started = Date.parse(state.generatedAt)
    if (state.generation !== current || started > +now || +now - started > 20 * 60_000)
        throw new MatrixExportChanged('Matrix export changed or expired; restart synchronization')
    const rows = await database.list('reviewedPatterns', undefined, undefined, state.after || undefined)
    const records: Record<string, any>[] = []
    let expiresAt = started + 86_400_000
    for (const row of rows) {
        const result = await database.transaction(async transaction => {
            const pattern = await transaction.get(row.path)
            if (!pattern) return
            const [installation, original, contact] = await Promise.all([
                transaction.get(`installations/${pattern.installId}`),
                transaction.get(`diagnostics/${pattern.sourceRecord}`),
                transaction.get(`contacts/${pattern.installId}`),
            ])
            if (
                !installation ||
                installation.revoked ||
                !original ||
                !(original.expiresAt instanceof Date) ||
                +original.expiresAt <= +now
            )
                return
            const { expiresAt: _expiry, ...value } = pattern
            return {
                value: {
                    ...value,
                    credit: contact?.confirmedAt && contact.credit?.publish === true ? contact.credit : null,
                },
                expiresAt: +original.expiresAt,
            }
        })
        if (result) {
            records.push(result.value)
            expiresAt = Math.min(expiresAt, result.expiresAt)
        }
    }
    if ((await generation(database)) !== current)
        throw new MatrixExportChanged('Matrix export changed; restart synchronization')
    const done = rows.length < 100
    return {
        schema: 'darkgrade.matrix-diagnostics-page/v1',
        id: createHash('sha256')
            .update(state.generation + '/' + state.generatedAt)
            .digest('hex'),
        generatedAt: state.generatedAt,
        expiresAt: new Date(expiresAt).toISOString(),
        index: state.index,
        done,
        hardwarePass: false,
        records,
        next: done
            ? null
            : Buffer.from(
                  JSON.stringify({
                      ...state,
                      after: rows.at(-1)!.path,
                      index: state.index + 1,
                  })
              ).toString('base64url'),
    }
}
