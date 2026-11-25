import type { exposureControlDefinitions } from '@camera/settings/exposure'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@ptp/definitions/vendors/canon/canon-property-definitions'
import * as nikon from '@ptp/definitions/vendors/nikon/nikon-shooting-property-definitions'
import * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

const standardProperties = {
    shutterSpeed: [standard.ExposureTime],
    iso: [standard.ExposureIndex],
    aperture: [standard.FNumber],
    exposureProgram: [standard.ExposureProgramMode],
} as const

/**
 * The exposure group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const exposureControlProperties = {
    sony: {
        shutterSpeed: [sony.ShutterSpeed],
        iso: [sony.Iso],
        aperture: [sony.Aperture, standard.FNumber],
        exposureProgram: [standard.ExposureProgramMode],
    },
    canon: {
        shutterSpeed: [canon.CanonShutterSpeed],
        iso: [canon.CanonIso],
        aperture: [canon.CanonAperture],
        exposureProgram: [canon.CanonAutoExposureMode],
    },
    standard: standardProperties,
    nikonPhoto: {
        ...standardProperties,
        shutterSpeed: [nikon.NikonPhotoShutterSpeed, standard.ExposureTime],
    },
    nikonMovie: {
        ...standardProperties,
        shutterSpeed: [nikon.NikonMovieShutterSpeed, standard.ExposureTime],
        iso: [nikon.NikonMovieISO],
        aperture: [nikon.NikonMovieFNumber],
    },
} as const satisfies VendorControlProperties<keyof typeof exposureControlDefinitions>
