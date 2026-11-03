import { issueGrant } from '#collector/token'
import { randomUUID } from 'node:crypto'

const termsVersion = process.argv[2]
if (!termsVersion)
    throw new Error(
        'Usage: npm run token -- TERMS_VERSION [CONTRIBUTOR_UUID]. Enroll after presenting the default-on diagnostic notice and opt-out setting.'
    )
const contributorId = process.argv[3] ?? randomUUID()
const token = issueGrant(
    { contributorId, termsVersion, expiresAt: Math.floor(Date.now() / 1000) + 15 * 60 },
    { id: process.env.CONTRIBUTION_KEY_ID ?? '', privateKey: process.env.CONTRIBUTION_PRIVATE_KEY ?? '' }
)
process.stdout.write(JSON.stringify({ contributorId, token, expiresInSeconds: 900 }) + '\n')
