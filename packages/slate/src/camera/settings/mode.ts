import type { SettingReaders } from '@camera/settings/setting-types'

/** Mode settings: photo/video and drive mode. Canonical ids, labels and search aliases. */
export const modeControlDefinitions = {} as const

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled as settings gain typed accessors
export interface ModeSettingTypes {}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const modeSettingReaders: SettingReaders<ModeSettingTypes> = {}
