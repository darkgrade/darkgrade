import identities from '@camera/identification/camera-identities.json'

/** Coverage of a particular profile, not a claim that every control works on the model. */
export interface CameraProfileEvidence {
    profileId: string
    fidelity: 'captured' | 'documented'
    firmware?: string
    deviceInfo: 'raw' | 'parsed' | 'partial' | 'absent'
    advertisedOperationCount: number
    exchangeCount: number
    descriptorCount: number
    simulatedQuirkCount: number
    sources: string[]
}

export interface CameraIdentityCandidate {
    manufacturer: string
    line: string
    models: string[]
    sources: string[]
    profiles: CameraProfileEvidence[]
}

export interface CameraIdentification {
    usb: { vendorId: number; productId: number }
    status: 'unknown' | 'matched' | 'ambiguous' | 'identity-mismatch'
    candidates: CameraIdentityCandidate[]
}

/**
 * Resolves USB identity without opening a device or starting any service. Shared product IDs
 * retain all candidates. Optional PTP model readback must match a known alias exactly (ignoring
 * case and whitespace); a conflict is reported, never used to select another camera silently.
 * Evidence remains scoped to its profile and firmware. USB recognition alone proves no control.
 */
export function identifyCamera(input: {
    vendorId: number
    productId: number
    ptpModel?: string
}): CameraIdentification {
    for (const value of [input.vendorId, input.productId]) {
        if (!Number.isInteger(value) || value < 0 || value > 0xffff)
            throw new Error('USB IDs must be unsigned 16-bit integers')
    }
    const key = [input.vendorId, input.productId].map(value => value.toString(16).padStart(4, '0')).join(':')
    const table = identities as unknown as Record<string, CameraIdentityCandidate[]>
    const candidates = structuredClone(table[key] ?? [])
    const usb = { vendorId: input.vendorId, productId: input.productId }
    if (!candidates.length) return { usb, status: 'unknown', candidates }
    const normalize = (model: string) => model.trim().toLowerCase().replace(/\s+/g, ' ')
    const requestedModel = input.ptpModel === undefined ? undefined : normalize(input.ptpModel)
    const matching =
        requestedModel === undefined
            ? candidates
            : candidates.filter(candidate => candidate.models.some(model => normalize(model) === requestedModel))
    if (!matching.length) return { usb, status: 'identity-mismatch', candidates }
    return { usb, status: matching.length === 1 ? 'matched' : 'ambiguous', candidates: matching }
}
