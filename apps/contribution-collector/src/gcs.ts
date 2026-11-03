import { firestoreState } from '#collector/firestore'
import { isContributionId } from '@darkgrade/contribute/schema'

/** Cloud Run workload identity only. No service-account key or user credential is sent to clients. */
export function googleCloudStore(bucket: string, project: string, request: typeof fetch = fetch) {
    if (!/^[a-z0-9][a-z0-9._-]{2,221}$/.test(bucket)) throw new Error('Invalid contribution bucket')
    const objectBase = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o`
    let token: { value: string; expires: number } | undefined
    const accessToken = async () => {
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
        if (!data.access_token || !Number.isFinite(data.expires_in)) throw new Error('Invalid workload token')
        token = { value: data.access_token, expires: Date.now() + data.expires_in * 1000 }
        return token.value
    }
    const call = async (url: string, init: RequestInit = {}) =>
        request(url, {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${await accessToken()}` },
            signal: AbortSignal.timeout(15_000),
            redirect: 'error',
        })
    const create = async (key: string, body: string) => {
        const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(key)}`
        const result = await call(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
        if (result.status === 412) return false
        if (!result.ok) throw new Error('Object creation failed')
        return true
    }
    const remove = async (key: string) => {
        const result = await call(`${objectBase}/${encodeURIComponent(key)}`, { method: 'DELETE' })
        if (!result.ok && result.status !== 404) throw new Error('Object deletion failed')
    }
    const state = firestoreState(project, call)
    return {
        create,
        remove,
        ...state,
        async revoked(contributor: string) {
            if (!isContributionId(contributor)) throw new Error('Invalid contributor')
            if (await state.revoked(contributor)) return true
            // Read-through migration preserves every legacy tombstone; no new state is written to GCS.
            const legacy = await call(`${objectBase}/${encodeURIComponent(`revoked/${contributor}.json`)}`)
            if (legacy.status === 404) return false
            if (!legacy.ok) throw new Error('Legacy revocation check unavailable')
            await state.revoke(contributor)
            return true
        },
        async migrateLegacyWithdrawals() {
            let pageToken = '',
                migrated = 0
            do {
                const result = await call(
                    `${objectBase}?prefix=revoked%2F&maxResults=100${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`
                )
                if (!result.ok) throw new Error('Legacy withdrawal listing unavailable')
                const page = (await result.json()) as { items?: { name: string }[]; nextPageToken?: string }
                for (const item of page.items ?? []) {
                    const match = /^revoked\/([^/]+)\.json$/.exec(item.name)
                    if (!match || !isContributionId(match[1])) throw new Error('Invalid legacy revocation scope')
                    await state.revoke(match[1])
                    migrated++
                }
                pageToken = page.nextPageToken ?? ''
            } while (pageToken)
            return migrated
        },
        async removeContributions(contributor: string) {
            if (!isContributionId(contributor)) throw new Error('Invalid contributor')
            // Delete one bounded page at a time; repeat from the beginning to avoid pagination skips.
            for (let page = 0; page < 100; page++) {
                const result = await call(
                    `${objectBase}?prefix=${encodeURIComponent(`contributions/${contributor}/`)}&maxResults=100`
                )
                if (!result.ok) throw new Error('Contribution listing failed')
                const data = (await result.json()) as { items?: { name: string }[] }
                if (!data.items?.length) return
                for (const item of data.items) {
                    if (!item.name.startsWith(`contributions/${contributor}/`)) throw new Error('Invalid object scope')
                    await remove(item.name)
                }
            }
            throw new Error('Withdrawal cleanup incomplete; retry')
        },
    }
}
