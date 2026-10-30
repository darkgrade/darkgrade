import type { PropertyAccess, PropertyDefinition } from '@ptp/types/property'

/**
 * Shooting property codes/types: libgphoto2 config.c and ptp.h at 02d92fea8a269eb94330a4eade204ba799433606.
 * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/config.c#L12079
 * Preset codes: filmkit constants.ts at 9e3bbcf858b1f9dc522e90adf7e385554f5969e2, corroborated by
 * apolozanionut's X-T50 firmware 1.31 captures: https://github.com/eggricesoy/filmkit/issues/12.
 *
 * Preserve raw values. Preset grain 6 and white balance 0x8008 occur in the capture; a guessed enum
 * would reject them. Access permits an operation; the camera's descriptor/mode still governs it.
 * Preset properties address the slot selected by 0xd18c, not the active shooting settings.
 */
const scalar = <Name extends string>(
    code: number,
    name: Name,
    description: string,
    signed = false,
    access: PropertyAccess = 'GetSet'
) =>
    ({
        code,
        name,
        description,
        datatype: signed ? 0x0003 : 0x0004,
        access,
        codec: registry => (signed ? registry.codecs.int16 : registry.codecs.uint16),
    }) as const satisfies PropertyDefinition<number>

export const fujifilmPropertyRegistry = {
    FujiFilmSimulation: scalar(0xd001, 'FujiFilmSimulation', 'Shooting film simulation code'),
    FujiDynamicRange: scalar(0xd007, 'FujiDynamicRange', 'Shooting dynamic range percentage'),
    FujiColor: scalar(0xd008, 'FujiColor', 'Shooting color setting, raw Fujifilm value'),
    FujiColorSpace: scalar(0xd00a, 'FujiColorSpace', 'Shooting color space code'),
    FujiWhiteBalanceShiftRed: scalar(0xd00b, 'FujiWhiteBalanceShiftRed', 'Signed red white-balance shift', true),
    FujiWhiteBalanceShiftBlue: scalar(0xd00c, 'FujiWhiteBalanceShiftBlue', 'Signed blue white-balance shift', true),
    FujiColorTemperature: scalar(0xd017, 'FujiColorTemperature', 'Shooting color temperature'),
    FujiImageQuality: scalar(0xd018, 'FujiImageQuality', 'Shooting image-format code'),
    FujiNoiseReduction: scalar(0xd01c, 'FujiNoiseReduction', 'Shooting noise reduction, raw Fujifilm code'),
    FujiGrainEffect: scalar(0xd023, 'FujiGrainEffect', 'Shooting grain-effect code'),
    FujiDynamicRangePriority: scalar(0xd02e, 'FujiDynamicRangePriority', 'Dynamic-range priority code'),
    FujiColorChromeFxBlue: scalar(0xd030, 'FujiColorChromeFxBlue', 'Shooting Color Chrome FX Blue code'),
    FujiClarity: scalar(0xd032, 'FujiClarity', 'Shooting clarity, raw Fujifilm value'),
    FujiSmoothSkin: scalar(0xd189, 'FujiSmoothSkin', 'Shooting smooth-skin effect code'),
    FujiHighlightTone: scalar(0xd320, 'FujiHighlightTone', 'Shooting highlight tone, raw Fujifilm value'),
    FujiShadowTone: scalar(0xd321, 'FujiShadowTone', 'Shooting shadow tone, raw Fujifilm value'),
    FujiPresetSlot: scalar(0xd18c, 'FujiPresetSlot', 'Select custom preset slot; X-T50 captured slots 1 through 7'),
    FujiPresetImageSize: scalar(0xd18e, 'FujiPresetImageSize', 'Selected preset image-size code'),
    FujiPresetImageQuality: scalar(0xd18f, 'FujiPresetImageQuality', 'Selected preset image-quality code'),
    FujiPresetDynamicRange: scalar(0xd190, 'FujiPresetDynamicRange', 'Selected preset dynamic-range percentage'),
    FujiPresetFilmSimulation: scalar(0xd192, 'FujiPresetFilmSimulation', 'Selected preset film-simulation code'),
    FujiPresetMonochromeWarmCool: scalar(
        0xd193,
        'FujiPresetMonochromeWarmCool',
        'Selected preset warm/cool tone times ten; conditional write',
        true
    ),
    FujiPresetMonochromeMagentaGreen: scalar(
        0xd194,
        'FujiPresetMonochromeMagentaGreen',
        'Selected preset magenta/green tone times ten; conditional write',
        true
    ),
    FujiPresetGrainEffect: scalar(0xd195, 'FujiPresetGrainEffect', 'Selected preset grain-effect code'),
    FujiPresetColorChrome: scalar(0xd196, 'FujiPresetColorChrome', 'Selected preset Color Chrome code'),
    FujiPresetColorChromeFxBlue: scalar(
        0xd197,
        'FujiPresetColorChromeFxBlue',
        'Selected preset Color Chrome FX Blue code'
    ),
    FujiPresetSmoothSkin: scalar(0xd198, 'FujiPresetSmoothSkin', 'Selected preset smooth-skin code'),
    FujiPresetWhiteBalance: scalar(
        0xd199,
        'FujiPresetWhiteBalance',
        'Selected preset white-balance code, including vendor values above 0x8000'
    ),
    FujiPresetWhiteBalanceShiftRed: scalar(
        0xd19a,
        'FujiPresetWhiteBalanceShiftRed',
        'Selected preset signed red white-balance shift',
        true
    ),
    FujiPresetWhiteBalanceShiftBlue: scalar(
        0xd19b,
        'FujiPresetWhiteBalanceShiftBlue',
        'Selected preset signed blue white-balance shift',
        true
    ),
    FujiPresetColorTemperature: scalar(
        0xd19c,
        'FujiPresetColorTemperature',
        'Selected preset Kelvin temperature; conditional write'
    ),
    FujiPresetHighlightTone: scalar(
        0xd19d,
        'FujiPresetHighlightTone',
        'Selected preset signed highlight tone times ten',
        true
    ),
    FujiPresetShadowTone: scalar(0xd19e, 'FujiPresetShadowTone', 'Selected preset signed shadow tone times ten', true),
    FujiPresetColor: scalar(0xd19f, 'FujiPresetColor', 'Selected preset signed color value times ten', true),
    FujiPresetSharpness: scalar(0xd1a0, 'FujiPresetSharpness', 'Selected preset signed sharpness times ten', true),
    FujiPresetHighIsoNoiseReduction: scalar(
        0xd1a1,
        'FujiPresetHighIsoNoiseReduction',
        'Selected preset high-ISO noise-reduction code; not a signed times-ten value'
    ),
    FujiPresetClarity: scalar(0xd1a2, 'FujiPresetClarity', 'Selected preset signed clarity times ten', true),
    FujiPresetLongExposureNoiseReduction: scalar(
        0xd1a3,
        'FujiPresetLongExposureNoiseReduction',
        'Selected preset long-exposure noise-reduction code'
    ),
    FujiPresetColorSpace: scalar(0xd1a4, 'FujiPresetColorSpace', 'Selected preset color-space code'),
} as const
