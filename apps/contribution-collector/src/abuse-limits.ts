import type { Database } from '#collector/database'

/** Shared fixed windows survive restarts and apply across collector instances.
 * No caller-controlled forwarding headers or raw IP addresses become identities. */
export async function allowBurst(database: Database, scope: string, limit: number, now: Date) {
    const minute = Math.floor(+now / 60_000)
    return database.transaction(async transaction => {
        const path = `ingressQuotas/${scope}-${minute}`
        const previous = await transaction.get(path)
        if ((previous?.count ?? 0) >= limit) return false
        transaction.set(path, {
            count: (previous?.count ?? 0) + 1,
            expiresAt: new Date((minute + 2) * 60_000),
        })
        return true
    })
}

/** Cheap process-local admission before parsing a body or acquiring a database connection.
 * The shared database limits below remain authoritative across instances. */
export function admissionLimit(maximumPerSecond = 100, maximumConcurrent = 32) {
    let window = 0,
        requests = 0,
        active = 0
    return (now = Date.now()) => {
        const next = Math.floor(now / 1000)
        if (next !== window) {
            window = next
            requests = 0
        }
        if (++requests > maximumPerSecond || active >= maximumConcurrent) return undefined
        active++
        let released = false
        return () => {
            if (!released) {
                released = true
                active--
            }
        }
    }
}
