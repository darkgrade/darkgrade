import type { modeControlDefinitions } from '@camera/settings/mode'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@vendors/canon/definitions/canon-property-definitions'
import * as nikonCamera from '@vendors/nikon/definitions/nikon-property-definitions'
import * as nikon from '@vendors/nikon/definitions/nikon-shooting-property-definitions'
import * as sony from '@vendors/sony/definitions/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

/**
 * The mode group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 *
 * photoVideoMode is one property only on Nikon (LiveViewSelector). On Canon it is the movie
 * select switch operations read back through FixedMovie, and on Sony the photo and movie halves of
 * the exposure program; both are composed in `@vendors/photo-video-mode`.
 */
export const modeControlProperties = {
    sony: {
        driveMode: [sony.StillCaptureMode],
    },
    canon: {
        driveMode: [canon.CanonDriveMode],
    },
    standard: {
        driveMode: [standard.StillCaptureMode],
    },
    nikonPhoto: {
        photoVideoMode: [nikonCamera.LiveViewSelector],
        driveMode: [nikon.NikonStillCaptureMode],
    },
    nikonMovie: {
        photoVideoMode: [nikonCamera.LiveViewSelector],
    },
} as const satisfies VendorControlProperties<keyof typeof modeControlDefinitions>
