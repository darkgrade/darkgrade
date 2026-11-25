import type { photoControlDefinitions } from '@camera/settings/photo'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@ptp/definitions/vendors/canon/canon-property-definitions'
import * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

const standardProperties = {
    imageSize: [standard.ImageSize],
} as const

/**
 * The photo group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const photoControlProperties = {
    sony: {
        stillFormat: [sony.StillFileFormat, sony.CompressionSetting],
        imageSize: [sony.SonyImageSize],
        aspectRatio: [sony.AspectRatio],
        jpegQuality: [sony.JpegQuality],
    },
    canon: {
        stillFormat: [canon.CanonImageFormat, canon.CanonImageFormatSd],
    },
    standard: standardProperties,
    nikonPhoto: {
        ...standardProperties,
    },
    nikonMovie: {
        ...standardProperties,
    },
} as const satisfies VendorControlProperties<keyof typeof photoControlDefinitions>
