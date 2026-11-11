import { firestoreDatabase } from '#collector/database'
import { exportReviewedPatterns, reviewDiagnostic } from '#collector/review'
import { cleanupWithdrawals } from '#collector/telemetry'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'

let credential: Promise<string> | undefined,
    credentialExpires = 0
const database = firestoreDatabase(process.env.GOOGLE_CLOUD_PROJECT ?? '', {
    ...(process.env.FIRESTORE_EMULATOR_HOST && { emulator: process.env.FIRESTORE_EMULATOR_HOST }),
    ...(process.env.TELEMETRY_OPERATOR_AUTH === 'gcloud' && {
        accessToken: async (refresh = false) => {
            if (refresh || Date.now() >= credentialExpires) credential = undefined
            credentialExpires = Date.now() + 60_000
            return (credential ??= promisify(execFile)('gcloud', ['auth', 'print-access-token'], {
                timeout: 10_000,
                maxBuffer: 16_384,
            })
                .then(result => {
                    const token = result.stdout.trim()
                    if (!token) throw new Error('Operator credentials unavailable')
                    return token
                })
                .catch(error => {
                    credential = undefined
                    throw error
                }))
        },
    }),
})
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
