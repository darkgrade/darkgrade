import { expect, it } from 'vitest'
import { compareSonyModels } from '@vendors/sony/model-contracts'

it('distinguishes a6700 ISO semantics from the FX2 separate gain mode', () => {
    const comparison = compareSonyModels('a6700', 'FX2')
    expect(comparison.shared).toContain('IsoSensitivity')
    expect(comparison.targetOnly).toContain('GainControlSetting')
    expect(comparison.targetOnly).toContain('FocusPositionSetting')
    expect(comparison.evidenceType).toBe('sdk-documented')
    expect(() => compareSonyModels('a6700', 'ILCE-6000')).toThrow('reviewed Sony SDK catalog')
})
