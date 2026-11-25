import { enumeratedSettingReader, type SettingReaders, type SettingTypes } from '@camera/settings/setting-types'
import type * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { CanonicalValueNames } from '@vendors/control-properties/vendor-control-properties'

/** Video settings. Canonical ids, labels and search aliases. */
export const videoControlDefinitions = {
    movieFormat: { label: 'Movie format', aliases: ['movie format', 'recording format'] },
    movieSetting: { label: 'Movie quality', aliases: ['movie setting', 'movie quality'] },
    movieFrameRate: { label: 'Frame rate', aliases: ['frame rate'] },
    digitalZoom: {
        label: 'Digital zoom',
        aliases: ['zoom setting', 'zoomSetting', 'zoom mode', 'zoomMode', 'zoom range'],
    },
} as const

/**
 * Canonical names for this group's codec values, keyed by vendor property name. Type-only codec
 * imports keep this vocabulary browser-safe; the compiler still checks every codec value has a name.
 */
export const videoValueNames = {
    ZoomSetting: { 'Optical Zoom Only': 'Off', 'Clear Image Zoom': 'Clear Image Zoom', 'Digital Zoom': 'Digital Zoom' },
} as const satisfies { ZoomSetting: CanonicalValueNames<typeof sony.ZoomSetting> }

/** How far zoom reaches past the optics: Off is optical only. From the codecs. */
export type DigitalZoom = (typeof videoValueNames.ZoomSetting)[keyof typeof videoValueNames.ZoomSetting]

const digitalZoomValues: readonly DigitalZoom[] = Object.values(videoValueNames.ZoomSetting)

/**
 * Value types of this group's typed settings: each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera. Follow `exposure.ts` (shutterSpeed is the worked example).
 */
export interface VideoSettingTypes {
    digitalZoom: SettingTypes<DigitalZoom>
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const videoSettingReaders: SettingReaders<VideoSettingTypes> = {
    digitalZoom: enumeratedSettingReader('digitalZoom', digitalZoomValues),
}
