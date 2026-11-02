import { issueGrant } from '#collector/token'
import { randomUUID } from 'node:crypto'

const termsVersion = process.argv[2]
if (!termsVersion)
    throw new Error('Usage: npm run token -- TERMS_VERSION [CONTRIBUTOR_UUID]. Enroll only after recording consent.')
const contributorId = process.argv[3] ?? randomUUID()
const token = issueGrant(
    { contributorId, termsVersion, expiresAt: Math.floor(Date.now() / 1000) + 30 * 86400 },
    process.env.CONTRIBUTION_SIGNING_KEY ?? ''
)
process.stdout.write(JSON.stringify({ contributorId, token, expiresInDays: 30 }) + '\n')
