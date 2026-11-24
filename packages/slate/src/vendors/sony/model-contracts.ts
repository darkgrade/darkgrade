import catalog from '@vendors/sony/model-contracts.json'

export const sonyModelContracts = catalog
function modelName(value: string): string {
    const model = value.trim().replace(/^sony\s+/i, '').toUpperCase()
    const aliases: Record<string, string> = { A6700: 'ILCE-6700', FX2: 'ILME-FX2', FX3: 'ILME-FX3', FX30: 'ILME-FX30', A7IV: 'ILCE-7M4', A7CII: 'ILCE-7CM2', A7CR: 'ILCE-7CR', A7RV: 'ILCE-7RM5' }
    return aliases[model] || model
}
/** SDK feature contracts are comparison evidence, never a replacement for runtime advertisement. */
export function compareSonyModels(sourceModel: string, targetModel: string) {
    const source = modelName(sourceModel), target = modelName(targetModel)
    if (!catalog.models.includes(source) || !catalog.models.includes(target))
        throw new Error('Choose a model in the reviewed Sony SDK catalog')
    const shared: string[] = [], sourceOnly: string[] = [], targetOnly: string[] = [], neither: string[] = []
    for (const [feature, models] of Object.entries(catalog.features)) {
        const from = models.includes(source), to = models.includes(target)
        ;(from && to ? shared : from ? sourceOnly : to ? targetOnly : neither).push(feature)
    }
    return {
        sourceModel: source, targetModel: target, evidenceType: 'sdk-documented', provenance: catalog.source,
        shared, sourceOnly, targetOnly, neither,
        isoStrategy: (catalog.features.GainControlSetting as string[]).includes(target)
            ? 'Use the separate Auto/Manual control only when the current camera advertises and enables it; otherwise use advertised ISO choices.'
            : 'This SDK table does not document the separate GainControlSetting; use advertised ISO choices.',
        scope: 'Shared SDK semantics identify reusable tests. They do not establish native PTP codes, enabled shooting modes, supported transport, value ranges, timing or successful writes on the target.',
    }
}
