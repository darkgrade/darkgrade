import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import type { PropertyDefinition } from '@ptp/types/property'

/**
 * Z6 III command specification Rev.2.00, shooting/status property sections.
 * Codes and current values also observed through test-bench camera_controls on 2026-10-29.
 * Keep the wire numbers: supported choices and current writability come from the body,
 * and movie controls depend on exposure mode, Auto ISO, lens and recording state.
 */
function scalarProperty<const Name extends string>(
    name: Name,
    code: number,
    type: 'uint8' | 'uint16' | 'uint32',
    description: string,
    access: 'Get' | 'GetSet' = 'GetSet'
) {
    return {
        name,
        code,
        description,
        datatype: getDatatypeByName(type.toUpperCase())!.code,
        access,
        codec: registry => registry.codecs[type],
    } satisfies PropertyDefinition<number>
}

export const NikonWhiteBalanceKelvin = scalarProperty(
    'NikonWhiteBalanceKelvin', 0xd01e, 'uint16', 'Photo white balance temperature in kelvin'
)
export const NikonMovieWhiteBalanceKelvin = scalarProperty(
    'NikonMovieWhiteBalanceKelvin', 0xd21a, 'uint16', 'Movie white balance temperature in kelvin'
)
export const NikonMovieISO = scalarProperty(
    'NikonMovieISO', 0xd1aa, 'uint32', 'Movie ISO sensitivity in manual exposure mode; raw camera value'
)
export const NikonPhotoAutoISO = scalarProperty(
    'NikonPhotoAutoISO', 0xd054, 'uint8', 'Photo Auto ISO: 0 off, 1 on'
)
export const NikonRawCompression = scalarProperty(
    'NikonRawCompression', 0xd016, 'uint8', 'NEF compression: 0 lossless, 3 high efficiency star, 4 high efficiency'
)
export const NikonMovieAutoISO = scalarProperty(
    'NikonMovieAutoISO', 0xd0ad, 'uint8', 'Movie Auto ISO in manual exposure mode: 0 off, 1 on'
)
export const NikonMovieWhiteBalance = scalarProperty(
    'NikonMovieWhiteBalance', 0xd23a, 'uint16', 'Movie white balance selection; raw camera value'
)
export const NikonMovieShutterSpeed = scalarProperty(
    'NikonMovieShutterSpeed', 0xd1a8, 'uint32', 'Movie exposure time: upper 16 bits numerator, lower 16 bits denominator'
)
export const NikonMovieFNumber = scalarProperty(
    'NikonMovieFNumber', 0xd1a9, 'uint16', 'Movie aperture in hundredths of an f-number'
)
export const NikonStillFocusMode = scalarProperty(
    'NikonStillFocusMode', 0xd061, 'uint8', 'Photo focus mode: 0 AF-S, 1 AF-C, 4 manual'
)
export const NikonMovieFocusMode = scalarProperty(
    'NikonMovieFocusMode', 0xd1fa, 'uint8', 'Movie focus mode: 0 AF-S, 1 AF-C, 2 AF-F, 4 manual'
)
export const NikonPrimarySlot = scalarProperty(
    'NikonPrimarySlot', 0xd156, 'uint8', 'Primary memory card slot'
)
export const NikonSecondarySlotMode = scalarProperty(
    'NikonSecondarySlotMode', 0xd148, 'uint8', 'Secondary card use: 0 overflow, 1 backup, 2 RAW/JPEG split; other choices are model-specific'
)
export const NikonActiveSlot = scalarProperty(
    'NikonActiveSlot', 0xd1f2, 'uint8', 'Active memory card slot: 0 none', 'Get'
)
export const NikonExposureRemaining = scalarProperty(
    'NikonExposureRemaining', 0xd1f1, 'uint32', 'Remaining still exposures', 'Get'
)
export const NikonFocusPointLock = scalarProperty(
    'NikonFocusPointLock', 0x0001d015, 'uint8', 'Photo focus-point lock: 0 off, 1 on'
)
export const NikonMovieFocusPointLock = scalarProperty(
    'NikonMovieFocusPointLock', 0x0001d016, 'uint8', 'Movie focus-point lock: 0 off, 1 on'
)

export const nikonShootingPropertyRegistry = {
    NikonWhiteBalanceKelvin,
    NikonMovieWhiteBalanceKelvin,
    NikonMovieISO,
    NikonPhotoAutoISO,
    NikonRawCompression,
    NikonMovieAutoISO,
    NikonMovieWhiteBalance,
    NikonMovieShutterSpeed,
    NikonMovieFNumber,
    NikonStillFocusMode,
    NikonMovieFocusMode,
    NikonPrimarySlot,
    NikonSecondarySlotMode,
    NikonActiveSlot,
    NikonExposureRemaining,
    NikonFocusPointLock,
    NikonMovieFocusPointLock,
} as const
