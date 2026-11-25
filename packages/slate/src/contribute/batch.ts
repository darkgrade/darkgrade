import { validateContribution, type Contribution } from '@contribute/schema'

export const BATCH_SCHEMA = 'darkgrade.diagnostic-batch/v2'
// Versions the sharing terms, not their wording. The terms themselves (what is collected, why,
// where it goes and the controls) are stated only in the privacy policy, which this notice points to.
// A change to those terms requires a new notice version; the collector rejects versions it does not know.
export const NOTICE_VERSION = 'camera-diagnostics-90d/v1'
export const DIAGNOSTICS_NOTICE =
    'Darkgrade shares camera diagnostics to improve its products. Sharing starts on and can be turned off. What is collected, why and your controls: https://darkgrade.com/privacy'
export const MAXIMUM_BATCH_CAMERAS = 16

export interface DiagnosticBatch {
    schema: typeof BATCH_SCHEMA
    id: string
    contributions: Contribution[]
}

export function validateBatch(value: unknown): asserts value is DiagnosticBatch {
    const batch = value as DiagnosticBatch
    if (
        !batch ||
        typeof batch !== 'object' ||
        Array.isArray(batch) ||
        Object.keys(batch).some(key => !['schema', 'id', 'contributions'].includes(key)) ||
        batch.schema !== BATCH_SCHEMA ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(batch.id) ||
        !Array.isArray(batch.contributions) ||
        !batch.contributions.length ||
        batch.contributions.length > MAXIMUM_BATCH_CAMERAS
    )
        throw new Error('Invalid diagnostic batch')
    let entries = 0
    const ids = new Set<string>()
    for (const contribution of batch.contributions) {
        validateContribution(contribution)
        if (ids.has(contribution.id)) throw new Error('Duplicate camera contribution')
        ids.add(contribution.id)
        entries += contribution.entries.length
    }
    if (entries > 1000) throw new Error('Diagnostic entry limit exceeded')
}
