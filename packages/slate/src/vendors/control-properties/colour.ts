import type { colourControlDefinitions } from '@camera/settings/colour'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@ptp/definitions/vendors/canon/canon-property-definitions'
import * as nikon from '@ptp/definitions/vendors/nikon/nikon-shooting-property-definitions'
import * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

const standardProperties = {
    whiteBalance: [standard.WhiteBalance],
} as const

/**
 * The colour group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const colourControlProperties = {
    sony: {
        whiteBalance: [sony.WhiteBalance],
        colorTemperature: [sony.ColorTemperature],
    },
    canon: {
        whiteBalance: [canon.CanonWhiteBalance],
        colorTemperature: [canon.CanonColorTemperature],
    },
    standard: standardProperties,
    nikonPhoto: {
        ...standardProperties,
        colorTemperature: [nikon.NikonWhiteBalanceKelvin],
    },
    nikonMovie: {
        ...standardProperties,
        whiteBalance: [nikon.NikonMovieWhiteBalance],
        colorTemperature: [nikon.NikonMovieWhiteBalanceKelvin],
    },
} as const satisfies VendorControlProperties<keyof typeof colourControlDefinitions>
