import type { SettingReaders } from '@camera/settings/setting-types'

/** Colour settings. Canonical ids, labels and search aliases. */
export const colourControlDefinitions = {
    whiteBalance: { label: 'White balance', aliases: ['white balance'] },
    colorTemperature: { label: 'Colour temperature', aliases: ['colour temperature', 'color temperature', 'kelvin'] },
} as const

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled as settings gain typed accessors
export interface ColourSettingTypes {}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const colourSettingReaders: SettingReaders<ColourSettingTypes> = {}
