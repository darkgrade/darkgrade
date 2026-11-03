import { isContributionId } from '@darkgrade/contribute/schema'
import { createPrivateKey, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

export const MAXIMUM_GRANT_SECONDS = 15 * 60
export interface ContributorGrant {
    contributorId: string
    issuedAt: number
    expiresAt: number
    termsVersion: string
    credit?: { name: string; role: 'diagnostic contributor'; publish: true }
}
export interface SigningKey {
    id: string
    privateKey: string | KeyObject
}
/** Retain retired public keys for withdrawal; uploads can be disabled immediately for a compromised key. */
export type VerificationKeys = Record<string, { publicKey: string | KeyObject; uploads: boolean }>
const keyId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value)

function validateGrant(value: ContributorGrant) {
    if (
        !value ||
        typeof value !== 'object' ||
        !isContributionId(value.contributorId) ||
        !Number.isSafeInteger(value.issuedAt) ||
        value.issuedAt <= 0 ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= value.issuedAt ||
        value.expiresAt - value.issuedAt > MAXIMUM_GRANT_SECONDS ||
        typeof value.termsVersion !== 'string' ||
        !/^[a-z0-9./-]{1,80}$/i.test(value.termsVersion) ||
        Object.keys(value).some(
            key => !['contributorId', 'issuedAt', 'expiresAt', 'termsVersion', 'credit'].includes(key)
        )
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
function ed25519(key: KeyObject) {
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('Ed25519 key required')
    return key
}
export function issueGrant(input: Omit<ContributorGrant, 'issuedAt'>, key: SigningKey, now = Date.now()) {
    const issuedAt = Math.floor(now / 1000)
    const grant = { ...input, issuedAt }
    validateGrant(grant)
    if (!keyId(key.id)) throw new Error('Invalid signing key ID')
    const header = Buffer.from(
        JSON.stringify({ alg: 'EdDSA', typ: 'darkgrade-contribution+jwt', kid: key.id })
    ).toString('base64url')
    const payload = Buffer.from(JSON.stringify(grant)).toString('base64url')
    const privateKey = ed25519(typeof key.privateKey === 'string' ? createPrivateKey(key.privateKey) : key.privateKey)
    return `${header}.${payload}.${sign(null, Buffer.from(`${header}.${payload}`), privateKey).toString('base64url')}`
}
export function validateVerificationKeys(keys: VerificationKeys) {
    if (!keys || !Object.keys(keys).length || Object.keys(keys).length > 100)
        throw new Error('Missing verification keys')
    for (const [id, key] of Object.entries(keys)) {
        if (!keyId(id) || typeof key.uploads !== 'boolean') throw new Error('Invalid verification key')
        if (typeof key.publicKey === 'string' && key.publicKey.includes('PRIVATE KEY'))
            throw new Error('Collector requires public keys only')
        const publicKey = ed25519(typeof key.publicKey === 'string' ? createPublicKey(key.publicKey) : key.publicKey)
        if (publicKey.type !== 'public') throw new Error('Collector requires public keys only')
    }
}
/** An expired or retired-key grant permits withdrawal only. Unknown keys and future grants fail closed. */
export function verifyGrant(
    token: string,
    keys: VerificationKeys,
    withdrawal = false,
    now = Date.now()
): ContributorGrant {
    if (token.length > 4096) throw new Error('Invalid token')
    const parts = token.split('.')
    if (
        parts.length !== 3 ||
        parts.some(
            part => !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, 'base64url').toString('base64url') !== part
        )
    )
        throw new Error('Invalid token')
    const [header, payload, signature] = parts
    const claims = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'))
    if (
        claims.alg !== 'EdDSA' ||
        claims.typ !== 'darkgrade-contribution+jwt' ||
        !keyId(claims.kid) ||
        Object.keys(claims).some(key => !['alg', 'typ', 'kid'].includes(key)) ||
        !Object.hasOwn(keys, claims.kid)
    )
        throw new Error('Invalid key ID or algorithm')
    const key = keys[claims.kid]
    if (!withdrawal && !key.uploads) throw new Error('Retired upload key')
    const publicKey = ed25519(typeof key.publicKey === 'string' ? createPublicKey(key.publicKey) : key.publicKey)
    if (
        publicKey.type !== 'public' ||
        !verify(null, Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))
    )
        throw new Error('Invalid token signature')
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ContributorGrant
    validateGrant(grant)
    if (grant.issuedAt > Math.floor(now / 1000) + 30) throw new Error('Future token')
    if (!withdrawal && grant.expiresAt <= Math.floor(now / 1000)) throw new Error('Expired token')
    return grant
}
