/**
 * The single source of truth for which bodies Darkgrade has run on its physical test benches,
 * keyed by the exact DeviceInfo model string. Other bodies are not refused: features are tried
 * and fall back cleanly, and their results are marked `verified: false`.
 */
export const validatedCameraModels = ['ILCE-6700', 'ILME-FX2', 'Z6_3', 'Z5_2', 'Canon EOS R6 Mark III', 'Canon EOS R8 Mark II'] as const

/** Vendor features physically confirmed on specific bodies; anywhere else they are attempted, unverified. */
export const verifiedFeatureModels = {
    /** Sony Wi-Fi/Bluetooth pairing and SDK connect (PR #16). */
    'sony-wireless': ['ILCE-6700', 'ILME-FX2'],
    /** Sony card presence read through the SDK storage fallback. */
    'sony-card-fallback': ['ILCE-6700'],
    /** Nikon wireless status read without an advertised descriptor. */
    'nikon-wireless-status': ['Z6_3'],
} as const satisfies Record<string, readonly (typeof validatedCameraModels)[number][]>

export type VerifiedFeature = keyof typeof verifiedFeatureModels

const normalize = (model: string) => model.trim().replace(/\s+/g, ' ').toLowerCase()

export function isValidatedModel(model: string | undefined): boolean {
    return model !== undefined && validatedCameraModels.some(known => normalize(known) === normalize(model))
}

export function isVerifiedFeature(feature: VerifiedFeature, model: string | undefined): boolean {
    return model !== undefined && verifiedFeatureModels[feature].some(known => normalize(known) === normalize(model))
}
