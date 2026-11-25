import type { SettingReaders } from '@camera/settings/setting-types'

/** Photo settings. Canonical ids, labels and search aliases. */
export const photoControlDefinitions = {
    stillFormat: { label: 'Photo format', aliases: ['still format', 'photo format', 'imageFormat'] },
    imageSize: { label: 'Photo size', aliases: ['image size', 'photo size'] },
    aspectRatio: { label: 'Aspect ratio', aliases: ['aspect ratio'] },
    jpegQuality: { label: 'JPEG quality', aliases: ['jpeg quality'] },
} as const

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- filled as settings gain typed accessors
export interface PhotoSettingTypes {}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const photoSettingReaders: SettingReaders<PhotoSettingTypes> = {}
