import type { SettingReaders } from '@camera/settings/setting-types'

/** Focus settings. Canonical ids, labels and search aliases. */
export const focusControlDefinitions = {
    focusMode: { label: 'Focus mode', aliases: ['focus mode'] },
    focusArea: { label: 'Focus area', aliases: ['focus area'] },
    subjectRecognition: { label: 'Eye tracking', aliases: ['subject recognition', 'eye tracking'] },
    recognitionTarget: { label: 'Recognition target', aliases: ['recognition target'] },
    eyeSelect: { label: 'Eye', aliases: ['eye select'] },
} as const

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled as settings gain typed accessors
export interface FocusSettingTypes {}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const focusSettingReaders: SettingReaders<FocusSettingTypes> = {}
