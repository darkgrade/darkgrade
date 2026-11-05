import { isContributionId } from '@darkgrade/contribute/schema'
type CloudRequest = (url: string, init?: RequestInit) => Promise<Response>
type Document = { name: string; fields?: Record<string, any>; updateTime?: string }
const json = (body: unknown): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
})

/** Transactions make the quota reservation and revocation check one serializable decision. */
export function firestoreState(project: string, call: CloudRequest, now = () => new Date()) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project)) throw new Error('Invalid Firestore project')
    const database = `projects/${project}/databases/(default)`
    const base = `https://firestore.googleapis.com/v1/${database}/documents`
    const name = (path: string) => `${database}/documents/${path}`
    const contributorPath = (id: string) => {
        if (!isContributionId(id)) throw new Error('Invalid contributor')
        return `withdrawals/${id}`
    }
    const read = async (path: string): Promise<Document | undefined> => {
        const result = await call(`${base}/${path}`)
        if (result.status === 404) return undefined
        if (!result.ok) throw new Error('Firestore read failed')
        return (await result.json()) as Document
    }
    const commit = async (writes: unknown[], transaction?: string) => {
        const result = await call(`${base}:commit`, json({ writes, ...(transaction && { transaction }) }))
        if (!result.ok) throw new Error(`Firestore commit failed (${result.status})`)
    }
    return {
        async revoked(id: string) {
            return !!(await read(contributorPath(id)))
        },
        async revoke(id: string) {
            const path = contributorPath(id)
            // Create-only: retries do not reset the tombstone or lose sweep history.
            const result = await call(
                `${base}:commit`,
                json({
                    writes: [
                        {
                            update: {
                                name: name(path),
                                fields: { revokedAt: { timestampValue: now().toISOString() } },
                            },
                            currentDocument: { exists: false },
                        },
                    ],
                })
            )
            if (result.status === 409 && (await read(path))) return
            if (!result.ok) throw new Error('Firestore revocation failed')
        },
        async admit(id: string, digest: string) {
            const revokedPath = contributorPath(id)
            if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid quota digest')
            const date = now(),
                quota = `quotas/${id}-${date.toISOString().slice(0, 10)}`
            for (let attempt = 0; attempt < 5; attempt++) {
                const begun = await call(`${base}:beginTransaction`, json({ options: { readWrite: {} } }))
                if (!begun.ok) throw new Error('Quota transaction unavailable')
                const { transaction } = (await begun.json()) as { transaction: string }
                if (!transaction) throw new Error('Missing Firestore transaction')
                try {
                    const result = await call(
                        `${base}:batchGet`,
                        json({ documents: [name(revokedPath), name(quota)], transaction })
                    )
                    if (!result.ok) throw new Error('Quota read failed')
                    const documents = (await result.json()) as { found?: Document; missing?: string }[]
                    if (
                        !Array.isArray(documents) ||
                        documents.length !== 2 ||
                        new Set(documents.map(item => item.found?.name ?? item.missing)).size !== 2 ||
                        documents.some(
                            item => ![name(revokedPath), name(quota)].includes(item.found?.name ?? item.missing ?? '')
                        )
                    )
                        throw new Error('Invalid quota transaction result')
                    if (documents.some(item => item.found?.name === name(revokedPath))) return false
                    const saved = documents.find(item => item.found?.name === name(quota))?.found
                    if (
                        saved &&
                        (!saved.fields?.digests?.arrayValue || typeof saved.fields.digests.arrayValue !== 'object')
                    )
                        throw new Error('Invalid quota state')
                    const values = saved?.fields?.digests?.arrayValue?.values ?? []
                    if (
                        !Array.isArray(values) ||
                        values.length > 128 ||
                        values.some(item => !/^[a-f0-9]{64}$/.test(item.stringValue))
                    )
                        throw new Error('Invalid quota state')
                    const digests: string[] = values.map(item => item.stringValue)
                    if (digests.includes(digest)) return true
                    if (digests.length >= 128) return false
                    const written = await call(
                        `${base}:commit`,
                        json({
                            transaction,
                            writes: [
                                {
                                    update: {
                                        name: name(quota),
                                        fields: {
                                            digests: {
                                                arrayValue: {
                                                    values: [...digests, digest].map(stringValue => ({ stringValue })),
                                                },
                                            },
                                            expiresAt: {
                                                timestampValue: new Date(date.getTime() + 2 * 86400_000).toISOString(),
                                            },
                                        },
                                    },
                                },
                            ],
                        })
                    )
                    if (written.status === 409) {
                        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)))
                        continue
                    }
                    if (!written.ok) throw new Error('Quota reservation failed')
                    return true
                } finally {
                    await call(`${base}:rollback`, json({ transaction })).catch(() => {})
                }
            }
            throw new Error('Quota contended; retry later')
        },
        /** Revisit permanent tombstones, including successful withdrawals, to catch a late upload after a crash. */
        async sweep(removeContributions: (id: string) => Promise<void>, maximumPages = 10) {
            const cursor = await read('maintenance/withdrawal-sweep')
            let pageToken = cursor?.fields?.pageToken?.stringValue ?? ''
            let cleaned = 0,
                failed = 0
            for (let page = 0; page < maximumPages; page++) {
                const query = new URLSearchParams({ pageSize: '20', ...(pageToken && { pageToken }) })
                const result = await call(`${base}/withdrawals?${query}`)
                // Tokens may expire between scheduled jobs: restart safely from the beginning.
                if (result.status === 400 && pageToken) {
                    pageToken = ''
                    continue
                }
                if (!result.ok) throw new Error('Withdrawal queue unavailable')
                const data = (await result.json()) as { documents?: Document[]; nextPageToken?: string }
                for (const document of data.documents ?? []) {
                    const id = document.name.split('/').at(-1)!
                    if (document.name !== name(contributorPath(id))) throw new Error('Invalid withdrawal scope')
                    try {
                        await removeContributions(id)
                        await commit([
                            {
                                update: {
                                    name: document.name,
                                    fields: { lastSweptAt: { timestampValue: now().toISOString() } },
                                },
                                updateMask: { fieldPaths: ['lastSweptAt'] },
                                currentDocument: { exists: true },
                            },
                        ])
                        cleaned++
                    } catch {
                        failed++
                    }
                }
                pageToken = data.nextPageToken ?? ''
                await commit([
                    {
                        update: {
                            name: name('maintenance/withdrawal-sweep'),
                            fields: { pageToken: { stringValue: pageToken } },
                        },
                    },
                ])
                if (!pageToken) break
            }
            return { cleaned, failed }
        },
    }
}
