import type { focusControlDefinitions } from '@camera/settings/focus'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@ptp/definitions/vendors/canon/canon-property-definitions'
import * as nikon from '@ptp/definitions/vendors/nikon/nikon-shooting-property-definitions'
import * as sony from '@ptp/definitions/vendors/sony/sony-property-definitions'
import type { VendorControlProperties } from '@vendors/control-properties/vendor-control-properties'

const standardProperties = {
    focusMode: [standard.FocusMode],
} as const

/**
 * The focus group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const focusControlProperties = {
    sony: {
        focusMode: [sony.FocusMode],
        focusArea: [sony.FocusArea],
        subjectRecognition: [sony.SubjectRecognitionInAF],
        recognitionTarget: [sony.RecognitionTarget],
        eyeSelect: [sony.RightLeftEyeSelect],
    },
    canon: {
        focusMode: [canon.CanonFocusMode],
        focusArea: [canon.CanonLiveViewAutofocusMode],
    },
    standard: standardProperties,
    nikonPhoto: {
        ...standardProperties,
        focusMode: [nikon.NikonStillFocusMode, standard.FocusMode],
    },
    nikonMovie: {
        ...standardProperties,
        focusMode: [nikon.NikonMovieFocusMode],
    },
} as const satisfies VendorControlProperties<keyof typeof focusControlDefinitions>
