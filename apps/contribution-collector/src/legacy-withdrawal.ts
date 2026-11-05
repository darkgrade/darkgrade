import type { ContributorGrant } from '#collector/token'
import { isContributionId } from '@darkgrade/contribute/schema'
import { createHmac, timingSafeEqual } from 'node:crypto'

/** Migration only: legacy tokens can delete their owner's data, never upload or refresh a grant. */
export function verifyLegacyWithdrawal(token: string, keys: readonly string[]): ContributorGrant {
    if (!keys.length || keys.length > 4 || keys.some(key => Buffer.byteLength(key) < 32) || token.length > 2048)
        throw new Error('Invalid legacy withdrawal configuration')
    const parts = token.split('.')
    if (parts.length !== 2 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part)))
        throw new Error('Invalid legacy grant')
    const [payload, signature] = parts,
        received = Buffer.from(signature, 'base64url')
    const authentic = keys.some(key => {
        const expected = createHmac('sha256', key).update(`darkgrade-contribution-v1.${payload}`).digest()
        return received.length === expected.length && timingSafeEqual(received, expected)
    })
    if (!authentic) throw new Error('Invalid legacy signature')
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (
        !isContributionId(grant.contributorId) ||
        !Number.isSafeInteger(grant.expiresAt) ||
        grant.expiresAt <= 0 ||
        typeof grant.termsVersion !== 'string' ||
        !/^[a-z0-9./-]{1,80}$/i.test(grant.termsVersion) ||
        Object.keys(grant).some(key => !['contributorId', 'expiresAt', 'termsVersion', 'credit'].includes(key))
    )
        throw new Error('Invalid legacy grant')
    // The DELETE route only uses the identity. Never propagate legacy credit or use this for uploads.
    return {
        contributorId: grant.contributorId,
        termsVersion: grant.termsVersion,
        issuedAt: 0,
        expiresAt: grant.expiresAt,
    }
}
