import { identifyCamera } from '@camera/identification/camera-identification'
import { describe, expect, it } from 'vitest'

describe('runtime USB camera identity', () => {
    it('recognizes bench bodies by USB vendor and product ID', () => {
        const identity = identifyCamera({ vendorId: 0x04a9, productId: 0x3294 })
        expect(identity.status).toBe('matched')
        expect(identity.candidates[0].models).toContain('EOS 80D')
        expect(identity.candidates[0].sources.length).toBeGreaterThan(0)
        expect(identity).not.toHaveProperty('hardwareVerified')
    })

    it('does not conflate Sony alpha6700 pre-selection identity with an A7 III', () => {
        const identity = identifyCamera({ vendorId: 0x054c, productId: 0x096f })
        expect(identity.status).toBe('ambiguous')
        expect(identity.candidates.some(candidate => candidate.models.some(model => model.includes('A7III')))).toBe(
            true
        )
        expect(identity.candidates.some(candidate => candidate.models.some(model => model.includes('6700')))).toBe(true)
        const readback = identifyCamera({ vendorId: 0x054c, productId: 0x096f, ptpModel: 'ILCE-6700' })
        expect(readback.status).toBe('matched')
        expect(readback.candidates[0].models).toContain('ILCE-6700')
    })

    it('reports conflicting model readback and unknown USB modes without selecting a camera', () => {
        expect(identifyCamera({ vendorId: 0x04a9, productId: 0x3294, ptpModel: 'EOS R6 Mark III' }).status).toBe(
            'identity-mismatch'
        )
        expect(identifyCamera({ vendorId: 0x054c, productId: 0x0d68 }).status).toBe('unknown')
        expect(identifyCamera({ vendorId: 0xffff, productId: 0xffff }).candidates).toEqual([])
        expect(() => identifyCamera({ vendorId: -1, productId: 0x3294 })).toThrow('16-bit')
    })

    it('does not leak mutable shared state', () => {
        const first = identifyCamera({ vendorId: 0x054c, productId: 0x096f })
        first.candidates.length = 0
        expect(identifyCamera({ vendorId: 0x054c, productId: 0x096f }).candidates.length).toBeGreaterThan(0)
    })
})
