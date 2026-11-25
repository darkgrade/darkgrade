import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { createEnumCodec, createOpenEnumCodec, type EnumValue } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'

/**
 * Z6 III command specification Rev.2.00, shooting/status property sections.
 * Codes and current values also observed through test-bench camera_controls on 2026-10-29.
 * Keep the wire numbers: supported choices and current writability come from the body,
 * and movie controls depend on exposure mode, Auto ISO, lens and recording state.
 */
export function scalarProperty<const Name extends string>(
    name: Name,
    code: number,
    type: 'uint8' | 'uint16' | 'uint32' | 'int32',
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

/** A property whose wire values carry the given names. */
export function enumProperty<
    const Name extends string,
    const Values extends readonly EnumValue<number>[],
    const Access extends 'Get' | 'GetSet' = 'GetSet',
>(name: Name, code: number, type: 'uint8' | 'uint16', description: string, values: Values, access?: Access) {
    return {
        name,
        code,
        description,
        datatype: getDatatypeByName(type.toUpperCase())!.code,
        access: access ?? ('GetSet' as Access),
        codec: registry => createEnumCodec(registry, values, registry.codecs[type]),
    } as const satisfies PropertyDefinition
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
export const NikonPhotoAutoISO = scalarProperty('NikonPhotoAutoISO', 0xd054, 'uint8', 'Photo Auto ISO: 0 off, 1 on')
/**
 * NEF compression, from the same specification. Other bodies use the code differently (a Z 6
 * reports a range 0–2 with value 2), so a value without a name here reads as its raw number and
 * is never written.
 */
export const NikonRawCompression = {
    name: 'NikonRawCompression',
    code: 0xd016,
    description: 'NEF compression: 0 lossless, 3 high efficiency star, 4 high efficiency',
    datatype: getDatatypeByName('UINT8')!.code,
    access: 'GetSet',
    codec: registry =>
        createOpenEnumCodec(
            registry,
            [
                { value: 0, name: 'Lossless', description: 'Lossless compressed' },
                { value: 3, name: 'High efficiency★', description: 'High efficiency star' },
                { value: 4, name: 'High efficiency', description: 'High efficiency' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition
export const NikonMovieAutoISO = scalarProperty(
    'NikonMovieAutoISO', 0xd0ad, 'uint8', 'Movie Auto ISO in manual exposure mode: 0 off, 1 on'
)
export const NikonMovieShutterSpeed = scalarProperty(
    'NikonMovieShutterSpeed', 0xd1a8, 'uint32', 'Movie exposure time: upper 16 bits numerator, lower 16 bits denominator'
)
/** Nikon Z6III USB/MTP Rev.2 §6.5.6.10, pp.460–461; documented, not a new hardware capture. */
export const NikonPhotoShutterSpeed = scalarProperty(
    'NikonPhotoShutterSpeed', 0xd100, 'uint32',
    'Exact photo shutter: upper 16 bits numerator, lower 16 bits denominator; 0xffffffff Bulb, 0xfffffffd Time. Choices depend on camera mode and shutter type.'
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
export const NikonPrimarySlot = scalarProperty('NikonPrimarySlot', 0xd156, 'uint8', 'Primary memory card slot')
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

/**
 * Nikon white balance (photo 0x5005, movie 0xD23A), named in Slate's canonical white-balance
 * spelling: Nikon's "Sunny" is Daylight, "Incandescent" is Tungsten, "Preset manual" is Custom.
 * Values from the Nikon Z 9 USB/MTP reference (UsbMtpE_06) §6.5.1.4 and §6.5.3.14.
 */
export const nikonWhiteBalanceValues = [
    { value: 0x0002, name: 'Auto', description: 'Auto' },
    { value: 0x0004, name: 'Daylight', description: 'Sunny' },
    { value: 0x0005, name: 'Fluorescent', description: 'Fluorescent' },
    { value: 0x0006, name: 'Tungsten', description: 'Incandescent' },
    { value: 0x0007, name: 'Flash', description: 'Flash (photo only)' },
    { value: 0x8010, name: 'Cloudy', description: 'Cloudy' },
    { value: 0x8011, name: 'Shade', description: 'Shade' },
    { value: 0x8012, name: 'Color Temperature', description: 'Choose color temperature' },
    { value: 0x8013, name: 'Custom', description: 'Preset manual' },
    { value: 0x8015, name: 'Same as photo', description: 'Movie only: same as photo settings' },
    { value: 0x8016, name: 'Natural Light Auto', description: 'Natural light auto' },
] as const

/** Photo white balance: the standard 0x5005 code with Nikon's own values. */
export const NikonWhiteBalance = enumProperty(
    'WhiteBalance',
    0x5005,
    'uint16',
    'Photo white balance (Nikon values)',
    nikonWhiteBalanceValues.filter(entry => entry.value !== 0x8015)
)
export const NikonMovieWhiteBalance = enumProperty(
    'NikonMovieWhiteBalance',
    0xd23a,
    'uint16',
    'Movie white balance selection',
    nikonWhiteBalanceValues.filter(entry => entry.value !== 0x0007)
)

/** Release mode: the standard 0x5013 code with Nikon's values (Z 9 USB/MTP reference §6.5.1.15). */
export const NikonStillCaptureMode = enumProperty('StillCaptureMode', 0x5013, 'uint16', 'Release mode (Nikon values)', [
    { value: 0x0001, name: 'Single', description: 'Single-frame shooting' },
    { value: 0x0002, name: 'Continuous high', description: 'Continuous high-speed shooting' },
    { value: 0x8010, name: 'Continuous low', description: 'Continuous low-speed shooting' },
    { value: 0x8011, name: 'Self-timer', description: 'Self-timer' },
    { value: 0x8100, name: 'Quick setting', description: 'Release-mode dial at the quick setting position' },
])

/**
 * Picture Control, named in Slate's canonical look spelling (Z 9 USB/MTP reference §6.5.13.1 and
 * §6.5.13.2). 101-120 are Creative Picture Controls; 201-209 are Custom Picture Controls 1-9.
 */
const nikonPictureControlValues = [
    { value: 1, name: 'Standard', description: 'Standard' },
    { value: 2, name: 'Neutral', description: 'Neutral' },
    { value: 3, name: 'Vivid', description: 'Vivid' },
    { value: 4, name: 'Monochrome', description: 'Monochrome' },
    { value: 5, name: 'Portrait', description: 'Portrait' },
    { value: 6, name: 'Landscape', description: 'Landscape' },
    { value: 7, name: 'Flat', description: 'Flat' },
    { value: 8, name: 'Auto', description: 'Auto' },
    { value: 11, name: 'Rich tone portrait', description: 'Rich Tone Portrait' },
    { value: 100, name: 'Same as photo', description: 'Movie only: same as photo settings' },
    { value: 101, name: 'Dream', description: 'Creative Picture Control' },
    { value: 102, name: 'Morning', description: 'Creative Picture Control' },
    { value: 103, name: 'Pop', description: 'Creative Picture Control' },
    { value: 104, name: 'Sunday', description: 'Creative Picture Control' },
    { value: 105, name: 'Somber', description: 'Creative Picture Control' },
    { value: 106, name: 'Drama', description: 'Creative Picture Control' },
    { value: 107, name: 'Silence', description: 'Creative Picture Control' },
    { value: 108, name: 'Bleach', description: 'Creative Picture Control' },
    { value: 109, name: 'Melancholic', description: 'Creative Picture Control' },
    { value: 110, name: 'Pure', description: 'Creative Picture Control' },
    { value: 111, name: 'Denim', description: 'Creative Picture Control' },
    { value: 112, name: 'Toy', description: 'Creative Picture Control' },
    { value: 113, name: 'Sepia', description: 'Creative Picture Control' },
    { value: 114, name: 'Blue', description: 'Creative Picture Control' },
    { value: 115, name: 'Red', description: 'Creative Picture Control' },
    { value: 116, name: 'Pink', description: 'Creative Picture Control' },
    { value: 117, name: 'Charcoal', description: 'Creative Picture Control' },
    { value: 118, name: 'Graphite', description: 'Creative Picture Control' },
    { value: 119, name: 'Binary', description: 'Creative Picture Control' },
    { value: 120, name: 'Carbon', description: 'Creative Picture Control' },
    { value: 201, name: 'Custom 1', description: 'Custom Picture Control 1' },
    { value: 202, name: 'Custom 2', description: 'Custom Picture Control 2' },
    { value: 203, name: 'Custom 3', description: 'Custom Picture Control 3' },
    { value: 204, name: 'Custom 4', description: 'Custom Picture Control 4' },
    { value: 205, name: 'Custom 5', description: 'Custom Picture Control 5' },
    { value: 206, name: 'Custom 6', description: 'Custom Picture Control 6' },
    { value: 207, name: 'Custom 7', description: 'Custom Picture Control 7' },
    { value: 208, name: 'Custom 8', description: 'Custom Picture Control 8' },
    { value: 209, name: 'Custom 9', description: 'Custom Picture Control 9' },
] as const

/** ActivePicCtrlItem: the photo Picture Control. */
export const NikonPictureControl = enumProperty(
    'NikonPictureControl',
    0xd200,
    'uint16',
    'Photo Picture Control',
    nikonPictureControlValues.filter(entry => entry.value !== 100)
)
/** MovieActivePicCtrlItem: the video Picture Control. */
export const NikonMoviePictureControl = enumProperty(
    'NikonMoviePictureControl',
    0xd237,
    'uint16',
    'Movie Picture Control',
    nikonPictureControlValues
)

export const nikonShootingPropertyRegistry = {
    NikonWhiteBalanceKelvin,
    NikonMovieWhiteBalanceKelvin,
    NikonMovieISO,
    NikonPhotoAutoISO,
    NikonRawCompression,
    NikonMovieAutoISO,
    WhiteBalance: NikonWhiteBalance,
    NikonMovieWhiteBalance,
    StillCaptureMode: NikonStillCaptureMode,
    NikonPictureControl,
    NikonMoviePictureControl,
    NikonMovieShutterSpeed,
    NikonPhotoShutterSpeed,
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
