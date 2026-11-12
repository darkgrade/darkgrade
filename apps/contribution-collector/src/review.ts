import type { Database } from '#collector/database'
import { validateBatch } from '@darkgrade/contribute/batch'
import { createHash } from 'node:crypto'

/** Operator review uses database credentials, never the public installation-key API. */
export async function reviewDiagnostic(database: Database, recordId: string, now = new Date()) {
    if (!/^[a-f0-9-]{36}_[a-f0-9-]{36}$/.test(recordId)) throw new Error('Invalid diagnostic record ID')
    return database.transaction(async transaction => {
        const record = await transaction.get(`diagnostics/${recordId}`)
        if (!record || !(record.expiresAt instanceof Date) || +record.expiresAt <= +now)
            throw new Error('Diagnostic is missing or expired')
        const install = await transaction.get(`installations/${record.installId}`)
        if (!install || install.revoked) throw new Error('Contributor withdrew')
        const contact = await transaction.get(`contacts/${record.installId}`)
        if (createHash('sha256').update(record.payload).digest('hex') !== record.sha256)
            throw new Error('Diagnostic integrity check failed')
        const batch = JSON.parse(record.payload)
        validateBatch(batch)
        const patterns = batch.contributions.map(contribution => {
            const observed = new Map<
                string,
                {
                    kind: string
                    operation?: string
                    direction: string
                    code: number | null
                    count: number
                    errors: number
                    bytes: number
                    totalMilliseconds: number
                }
            >()
            for (const entry of contribution.entries) {
                const key = `${entry.kind}/${entry.direction}/${entry.operation ?? 'ptp'}/${entry.code ?? 'none'}`
                const summary = observed.get(key) ?? {
                    kind: entry.kind,
                    ...(entry.operation && { operation: entry.operation }),
                    direction: entry.direction,
                    code: entry.code ?? null,
                    count: 0,
                    errors: 0,
                    bytes: 0,
                    totalMilliseconds: 0,
                }
                summary.count++
                summary.errors += Number(
                    entry.failed || (entry.kind === 'response' && entry.code !== undefined && entry.code !== 0x2001)
                )
                summary.bytes += entry.bytes
                summary.totalMilliseconds += entry.durationMilliseconds
                observed.set(key, summary)
            }
            return {
                camera: contribution.camera,
                droppedEntries: contribution.droppedEntries,
                observed: [...observed.values()],
            }
        })
        const pattern = {
            schema: 'darkgrade.reviewed-pattern/v1',
            evidence: 'diagnostic-pattern',
            hardwarePass: false,
            installId: record.installId,
            sourceRecord: recordId,
            sourceHash: record.sha256,
            noticeVersion: record.noticeVersion,
            reviewedAt: now,
            source: '@darkgrade/contribute',
            credit: contact?.confirmedAt && contact?.credit?.publish === true ? contact.credit : null,
            patterns,
        }
        // Credit is resolved from the current verified contact at export, not copied permanently.
        transaction.set(`reviewedPatterns/${recordId}`, { ...pattern, credit: null })
        return pattern
    })
}

/** Replace a downstream snapshot wholesale. Consumers must not append stale, withdrawn rows. */
export async function exportReviewedPatterns(database: Database, now = new Date()) {
    const records: Record<string, any>[] = []
    let bytes = 1024
    let after: string | undefined
    for (;;) {
        const page = await database.list('reviewedPatterns', undefined, undefined, after)
        for (const row of page) {
            const current = await database.transaction(async transaction => {
                const pattern = await transaction.get(row.path)
                if (!pattern) return undefined
                const install = await transaction.get(`installations/${pattern.installId}`)
                if (!install || install.revoked) return undefined
                const contact = await transaction.get(`contacts/${pattern.installId}`)
                return {
                    ...pattern,
                    credit: contact?.confirmedAt && contact?.credit?.publish === true ? contact.credit : null,
                }
            })
            if (current) {
                bytes += Buffer.byteLength(JSON.stringify(current))
                if (bytes > 32 * 1024 * 1024 || records.length >= 10_000)
                    throw new Error(
                        'Reviewed snapshot exceeds Matrix import limits; partitioning support is required before exporting this corpus'
                    )
                records.push(current)
            }
        }
        if (page.length < 100) break
        after = page.at(-1)!.path
    }
    return {
        schema: 'darkgrade.matrix-diagnostics/v1',
        generatedAt: now.toISOString(),
        expiresAt: new Date(+now + 24 * 3_600_000).toISOString(),
        replace: true,
        hardwarePass: false,
        records,
    }
}
