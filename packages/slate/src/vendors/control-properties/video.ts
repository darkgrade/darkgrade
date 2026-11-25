import type { videoControlDefinitions } from '@camera/settings/video'
import * as canon from '@ptp/definitions/vendors/canon/canon-property-definitions'
import * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

/**
 * The video group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const videoControlProperties = {
    sony: {
        movieFormat: [sony.MovieFileFormat],
        movieSetting: [sony.MovieRecordingSetting],
        movieFrameRate: [sony.MovieRecordingFrameRate],
        digitalZoom: [sony.ZoomSetting],
    },
    canon: {
        movieFormat: [canon.CanonMovieFormat],
    },
    standard: {},
    nikonPhoto: {},
    nikonMovie: {},
} as const satisfies VendorControlProperties<keyof typeof videoControlDefinitions>
