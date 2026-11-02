import { isContributionId } from '@darkgrade/contribute/schema'
import { createHmac, timingSafeEqual } from 'node:crypto'

export interface ContributorGrant {
    contributorId: string
    expiresAt: number
    /** Set by the enrollment service after displaying its data-use notice. */
    termsVersion: string
    /** Optional public credit requires an explicit, separate choice. Never guess camera ownership. */
    credit?: { name: string; role: 'diagnostic contributor'; publish: true }
}

function validateGrant(value: ContributorGrant) {
    if (
        !value ||
        typeof value !== 'object' ||
        !isContributionId(value.contributorId) ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= 0 ||
        typeof value.termsVersion !== 'string' ||
        !/^[a-z0-9./-]{1,80}$/i.test(value.termsVersion) ||
        Object.keys(value).some(key => !['contributorId', 'expiresAt', 'termsVersion', 'credit'].includes(key))
    )
        throw new Error('Invalid contributor grant')
    if (
        value.credit !== undefined &&
        (!value.credit ||
            typeof value.credit !== 'object' ||
            value.credit.publish !== true ||
            value.credit.role !== 'diagnostic contributor' ||
            typeof value.credit.name !== 'string' ||
            value.credit.name.length > 80 ||
            !value.credit.name.trim() ||
            /[\u0000-\u001f<>]/.test(value.credit.name) ||
            Object.keys(value.credit).some(key => !['name', 'role', 'publish'].includes(key)))
    )
        throw new Error('Invalid contributor credit')
}

function signature(payload: string, key: string) {
    if (Buffer.byteLength(key) < 32) throw new Error('Signing key must contain at least 32 bytes')
    return createHmac('sha256', key).update(`darkgrade-contribution-v1.${payload}`).digest()
}

export function issueGrant(grant: ContributorGrant, key: string, now = Date.now()) {
    validateGrant(grant)
    if (grant.expiresAt <= Math.floor(now / 1000) || grant.expiresAt > Math.floor(now / 1000) + 90 * 86400)
        throw new Error('Upload grants must expire within 90 days')
    const payload = Buffer.from(JSON.stringify(grant)).toString('base64url')
    return `${payload}.${signature(payload, key).toString('base64url')}`
}

/** Expired, correctly signed tokens still permit withdrawal, never new uploads. */
export function verifyGrant(token: string, key: string, withdrawal = false, now = Date.now()): ContributorGrant {
    if (token.length > 2048) throw new Error('Invalid token')
    const [payload, mac, extra] = token.split('.')
    if (!payload || !mac || extra || !/^[A-Za-z0-9_-]+$/.test(payload + mac)) throw new Error('Invalid token')
    const received = Buffer.from(mac, 'base64url')
    const expected = signature(payload, key)
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new Error('Invalid token')
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ContributorGrant
    validateGrant(grant)
    if (!withdrawal && grant.expiresAt <= Math.floor(now / 1000)) throw new Error('Expired token')
    return grant
}
