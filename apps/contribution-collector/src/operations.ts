import { postgresDatabase } from '#collector/postgres'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { cleanupWithdrawals } from '#collector/telemetry'
import { randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'

const database = await postgresDatabase(process.env.DATABASE_URL ?? '')
const [operation, argument] = process.argv.slice(2)
try {
    if (operation === 'cleanup') {
        const result = { cleaned: 0, failed: 0, more: false }
        const deadline = Date.now() + 1_700_000
        do {
            const page = await cleanupWithdrawals(database)
            result.cleaned += page.cleaned
            result.failed += page.failed
            result.more = page.more
        } while (result.more && Date.now() < deadline)
        console.log(JSON.stringify({ component: 'contribution-withdrawal', ...result }))
        if (result.failed || result.more) process.exitCode = 1
    } else if (operation === 'review' && argument) {
        await reviewDiagnostic(database, argument)
        console.log(JSON.stringify({ reviewed: true }))
    } else if (operation === 'export' && argument) {
        const temporary = `${argument}.${randomUUID()}.tmp`
        try {
            await writeFile(temporary, JSON.stringify(await exportReviewedPatterns(database)), {
                mode: 0o600,
                flag: 'wx',
            })
            await rename(temporary, argument)
        } finally {
            await unlink(temporary).catch(() => {})
        }
        console.log(JSON.stringify({ exported: true }))
    } else throw new Error('Use cleanup, review RECORD_ID, or export FILE')
} catch {
    console.error(JSON.stringify({ component: 'contribution-operations', operation, failed: true }))
    process.exitCode = 1
}

await database.close()
