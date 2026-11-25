import type { liveViewControlDefinitions } from '@camera/settings/live-view'
import * as sony from '@vendors/sony/definitions/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

/**
 * The live view group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const liveViewControlProperties = {
    sony: {
        liveViewQuality: [sony.LiveViewImageQuality],
    },
    canon: {},
    standard: {},
    nikonPhoto: {},
    nikonMovie: {},
} as const satisfies VendorControlProperties<keyof typeof liveViewControlDefinitions>
