import { validateContribution, type Contribution } from '#contribute/schema'

export const BATCH_SCHEMA = 'darkgrade.diagnostic-batch/v2'
export const NOTICE_VERSION = 'camera-diagnostics-90d/v1'
export const DIAGNOSTICS_NOTICE =
    'Share camera command codes, outcomes, timing, model, firmware and driver revision to improve Darkgrade Link and train Matrix. Diagnostics are kept for 90 days; reviewed patterns may be retained longer with withdrawal linkage. Images, serial numbers and command parameters are excluded. Sharing starts on and can be turned off; withdrawal requests deletion. Email and public credit are optional.'
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
