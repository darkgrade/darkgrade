import { enumeratedSettingReader, type SettingReaders, type SettingTypes } from '@camera/settings/setting-types'
import type * as sony from '@vendors/sony/definitions/sony-property-definitions'
import type { CanonicalValueNames } from '@vendors/control-properties/vendor-control-properties'

/** Live-view settings. Canonical ids, labels and search aliases. */
export const liveViewControlDefinitions = {
    liveViewQuality: {
        label: 'Live-view quality',
        aliases: ['live view quality', 'preview quality', 'live view image quality'],
    },
} as const

/**
 * Canonical names for this group's codec values, keyed by vendor property name. Type-only codec
 * imports keep this vocabulary browser-safe; the compiler still checks every codec value has a name.
 */
export const liveViewValueNames = {
    LiveViewImageQuality: { LOW: 'Low', HIGH: 'High' },
} as const satisfies { LiveViewImageQuality: CanonicalValueNames<typeof sony.LiveViewImageQuality> }

/** The live-view picture's quality: High is sharper, Low lighter on the connection. From the codecs. */
export type LiveViewQuality =
    (typeof liveViewValueNames.LiveViewImageQuality)[keyof typeof liveViewValueNames.LiveViewImageQuality]

const liveViewQualityValues: readonly LiveViewQuality[] = Object.values(liveViewValueNames.LiveViewImageQuality)

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
export interface LiveViewSettingTypes {
    liveViewQuality: SettingTypes<LiveViewQuality>
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const liveViewSettingReaders: SettingReaders<LiveViewSettingTypes> = {
    liveViewQuality: enumeratedSettingReader('liveViewQuality', liveViewQualityValues),
}
