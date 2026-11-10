import { googleCloudStore } from '#collector/gcs'
const store = googleCloudStore(process.env.CONTRIBUTION_BUCKET ?? '', process.env.GOOGLE_CLOUD_PROJECT ?? '')
try {
    await store.migrateLegacyWithdrawals()
    const result = await store.sweep(store.removeContributions)
    console.log(JSON.stringify({ component: 'contribution-withdrawal', ...result }))
    if (result.failed) process.exitCode = 1
} catch {
    console.error(JSON.stringify({ component: 'contribution-withdrawal', failed: 1, state: 'unavailable' }))
    process.exitCode = 1
}
