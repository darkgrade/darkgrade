import type { Database } from '#collector/database'
import { diagnosticPattern } from '#collector/review'
import { createHash } from 'node:crypto'

interface Cursor {
    generation: string
    watermark: number
    generatedAt: string
    after: string
    index: number
}
export class MatrixExportChanged extends Error {}
export class InvalidMatrixCursor extends Error {}
const generation = async (database: Database) =>
    (await database.get('maintenance/matrix-generation'))?.value ?? 'initial'

/** Import all validated diagnostics. A committed ingestion watermark excludes later uploads without starving sync;
 * review/withdrawal/credit changes still invalidate the export. No automatic human-review claim. */
export async function exportMatrixPage(database: Database, cursor?: string, now = new Date()) {
    const current = await generation(database)
    const watermark = (await database.get('maintenance/ingestion-sequence'))?.value ?? 0
    let state: Cursor = { generation: current, watermark, generatedAt: now.toISOString(), after: '', index: 0 }
    if (cursor) {
        try {
            if (cursor.length > 800 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
            state = JSON.parse(Buffer.from(cursor, 'base64url').toString())
            if (
                Object.keys(state).sort().join(',') !== 'after,generatedAt,generation,index,watermark' ||
                !/^(initial|[a-f0-9-]{36})$/.test(state.generation) ||
                !/^diagnostics\/[a-f0-9-]{36}_[a-f0-9-]{36}$/.test(state.after) ||
                !Number.isSafeInteger(state.watermark) ||
                state.watermark < 0 ||
                state.watermark > watermark ||
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
    const rows = await database.list('diagnostics', undefined, undefined, state.after || undefined)
    const records: Record<string, any>[] = []
    let expiresAt = started + 86_400_000
    for (const row of rows) {
        const result = await database.transaction(async transaction => {
            const original = await transaction.get(row.path)
            if (!original || (original.ingestionSequence ?? 0) > state.watermark || +original.receivedAt > started)
                return
            const sourceRecord = row.path.slice('diagnostics/'.length)
            const [installation, reviewed, contact, research] = await Promise.all([
                transaction.get(`installations/${original.installId}`),
                transaction.get(`reviewedPatterns/${sourceRecord}`),
                transaction.get(`contacts/${original.installId}`),
                transaction.get(`protocolFindings/${sourceRecord}`),
            ])
            if (
                !installation ||
                installation.revoked ||
                !(original.expiresAt instanceof Date) ||
                +original.expiresAt <= +now
            )
                return
            return {
                value: diagnosticPattern(
                    sourceRecord,
                    original,
                    reviewed && reviewed.sourceHash === original.sha256 && reviewed.reviewedAt instanceof Date
                        ? reviewed.reviewedAt
                        : null,
                    contact?.confirmedAt && contact.credit?.publish === true ? contact.credit : null,
                    research && research.sourceHash === original.sha256 ? research.findings : []
                ),
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
            .update(state.generation + '/' + state.watermark + '/' + state.generatedAt)
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
