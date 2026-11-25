import type { SettingReaders } from '@camera/settings/setting-types'

/** Video settings. Canonical ids, labels and search aliases. */
export const videoControlDefinitions = {
    movieFormat: { label: 'Movie format', aliases: ['movie format', 'recording format'] },
    movieSetting: { label: 'Movie quality', aliases: ['movie setting', 'movie quality'] },
    movieFrameRate: { label: 'Frame rate', aliases: ['frame rate'] },
    zoomMode: { label: 'Zoom mode', aliases: ['zoom mode', 'zoomSetting'] },
} as const

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled as settings gain typed accessors
export interface VideoSettingTypes {}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const videoSettingReaders: SettingReaders<VideoSettingTypes> = {}
