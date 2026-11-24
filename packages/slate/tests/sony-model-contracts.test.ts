import { expect, it } from 'vitest'
import { compareSonyModels, sonyModelContracts } from '@vendors/sony/model-contracts'

it('distinguishes a6700 ISO semantics from the FX2 separate gain mode', () => {
    const comparison = compareSonyModels('a6700', 'FX2')
    expect(comparison.shared).toContain('IsoSensitivity')
    expect(comparison.targetOnly).toContain('GainControlSetting')
    expect(comparison.targetOnly).toContain('FocusPositionSetting')
    expect(comparison.evidenceType).toBe('sdk-documented')
})
it('carries the separate ISO contract to documented bodies, without claiming PTP verification', () => {
    for (const target of ['ILME-FX30', 'ILME-FX3', 'ILCE-7M4', 'ILCE-7CM2', 'ILCE-7CR', 'ILCE-7RM5']) {
        const result = compareSonyModels('FX2', target)
        expect(result.shared).toContain('GainControlSetting')
        expect(result.scope).toContain('do not establish native PTP codes')
    }
    expect(compareSonyModels('a6700', 'ZV-E10M2').neither).toContain('GainControlSetting')
    expect(sonyModelContracts.models).toHaveLength(31)
    expect(() => compareSonyModels('a6700', 'ILCE-6000')).toThrow('reviewed Sony SDK catalog')
})
