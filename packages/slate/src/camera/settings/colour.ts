import { namedSettingReader, type SettingReaders, type SettingTypes } from '@camera/settings/setting-types'
import { CameraUnsupportedError } from '@camera/errors'
import type { CodecValue } from '@vendors/control-properties'

/** Colour settings. Canonical ids, labels and search aliases. */
export const colourControlDefinitions = {
    whiteBalance: { label: 'White balance', aliases: ['white balance', 'wb'] },
    colorTemperature: { label: 'Colour temperature', aliases: ['colour temperature', 'color temperature', 'kelvin'] },
    pictureStyle: {
        label: 'Look',
        aliases: ['look', 'picture style', 'picture control', 'creative look', 'creative style', 'film simulation'],
    },
    pictureProfile: { label: 'Picture profile', aliases: ['picture profile', 'gamma', 'log'] },
} as const

/**
 * A white balance in Slate's one spelling, whatever the vendor calls it: Nikon's "Sunny" is
 * `'Daylight'`, Canon's kebab-case codes are `'Auto'`, `'Shade'`, `'Color Temperature'` and so on.
 * The names come from the vendor codecs (`@ptp/definitions`), one table per vendor and mode.
 */
export type WhiteBalance = CodecValue<'whiteBalance'>

/** A colour temperature in kelvin. */
export type ColorTemperature = number

/**
 * A look in Slate's one spelling: Canon Picture Style, Nikon Picture Control and Sony Creative
 * Look or Creative Style (`'Standard'`, `'Portrait'`, `'Monochrome'`, ...).
 */
export type PictureStyle = CodecValue<'pictureStyle'>

/** A Sony Picture Profile (`'Off'`, `'PP1'` to `'PP11'`, `'PP LUT 1'` to `'PP LUT 4'`). */
export type PictureProfile = CodecValue<'pictureProfile'>

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
export interface ColourSettingTypes {
    whiteBalance: SettingTypes<WhiteBalance>
    colorTemperature: SettingTypes<ColorTemperature>
    pictureStyle: SettingTypes<PictureStyle>
    pictureProfile: SettingTypes<PictureProfile>
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const colourSettingReaders: SettingReaders<ColourSettingTypes> = {
    whiteBalance: namedSettingReader<WhiteBalance>('White balance'),
    colorTemperature: state => {
        const kelvin = Number(state.value)
        if (state.unrecognized?.value !== undefined || !Number.isFinite(kelvin) || kelvin <= 0)
            throw new CameraUnsupportedError(
                'colorTemperature',
                `Colour temperature: the camera reports a value Slate cannot read (${state.value})`
            )
        return kelvin
    },
    pictureStyle: namedSettingReader<PictureStyle>('Look'),
    pictureProfile: namedSettingReader<PictureProfile>('Picture profile'),
}
