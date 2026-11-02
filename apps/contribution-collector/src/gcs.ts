import type { ContributionStore } from '#collector/collector'

/** Cloud Run workload identity only. No service-account key or user credential is sent to clients. */
export function googleCloudStore(bucket: string, request: typeof fetch = fetch): ContributionStore {
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
    return {
        create,
        remove,
        async admit(contributor, digest) {
            const quotaKey = `quotas/${contributor}/${new Date().toISOString().slice(0, 10)}.json`
            const quotaUrl = `${objectBase}/${encodeURIComponent(quotaKey)}`
            for (let attempt = 0; attempt < 5; attempt++) {
                const metadata = await call(`${quotaUrl}?fields=generation`)
                let generation = '0'
                let digests: string[] = []
                if (metadata.ok) {
                    generation = ((await metadata.json()) as { generation: string }).generation
                    if (!/^[1-9][0-9]*$/.test(generation)) throw new Error('Invalid quota generation')
                    const contents = await call(`${quotaUrl}?alt=media&ifGenerationMatch=${generation}`)
                    if (contents.status === 412) continue
                    if (!contents.ok) throw new Error('Quota read failed')
                    digests = (await contents.json()) as string[]
                    if (
                        !Array.isArray(digests) ||
                        digests.length > 128 ||
                        digests.some(value => !/^[a-f0-9]{64}$/.test(value))
                    )
                        throw new Error('Invalid quota state')
                } else if (metadata.status !== 404) throw new Error('Quota unavailable')
                if (digests.includes(digest)) return true
                if (digests.length >= 128) return false
                const url = `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&ifGenerationMatch=${generation}&name=${encodeURIComponent(quotaKey)}`
                const written = await call(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify([...digests, digest]),
                })
                if (written.status === 412) continue
                if (!written.ok) throw new Error('Quota update failed')
                return true
            }
            throw new Error('Quota contended; retry')
        },
        async revoked(contributor) {
            const result = await call(`${objectBase}/${encodeURIComponent(`revoked/${contributor}.json`)}`)
            if (result.status === 404) return false
            if (!result.ok) throw new Error('Consent check failed')
            return true
        },
        async revoke(contributor) {
            await create(`revoked/${contributor}.json`, '{"revoked":true}')
        },
        async removeContributions(contributor) {
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
