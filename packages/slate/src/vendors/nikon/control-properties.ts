import type { ExposureMode, MeteringMode } from '@camera/settings/values'
import type { CodecType } from '@ptp/types/codec'
import * as standard from '@ptp/definitions/property-definitions'
import type { ControlPropertyMap, ControlValueNameTable, ControlValueTable } from '@vendors/control-properties'
import {
    lookup,
    standardControlValues,
    standardExposureModes,
    standardFocusModes,
    standardMeteringModes,
} from '@vendors/generic/control-properties'
import type { NikonFocusModeLabel } from '@vendors/nikon/control-values'
import * as nikonCamera from '@vendors/nikon/definitions/nikon-property-definitions'
import * as nikon from '@vendors/nikon/definitions/nikon-shooting-property-definitions'

/**
 * Nikon's properties in photo mode (LiveViewSelector PHOTO): for each canonical id, the properties
 * that carry it in preference order. Typed definitions, so each setting's value type is derived
 * from the codecs (see `CodecValue`). photoVideoMode is the one LiveViewSelector property.
 */
export const nikonPhotoControlProperties = {
    shutterSpeed: [nikon.NikonPhotoShutterSpeed, standard.ExposureTime],
    iso: [standard.ExposureIndex],
    aperture: [standard.FNumber],
    exposureMode: [standard.ExposureProgramMode],
    exposureCompensation: [standard.ExposureBiasCompensation],
    meteringMode: [standard.ExposureMeteringMode],
    photoVideoMode: [nikonCamera.LiveViewSelector],
    driveMode: [nikon.NikonStillCaptureMode],
    whiteBalance: [nikon.NikonWhiteBalance],
    colorTemperature: [nikon.NikonWhiteBalanceKelvin],
    pictureStyle: [nikon.NikonPictureControl],
    focusMode: [nikon.NikonStillFocusMode, nikonCamera.FocusMode],
    photoSize: [standard.ImageSize],
    flashMode: [standard.FlashMode],
    rawCompression: [nikon.NikonRawCompression],
} as const satisfies ControlPropertyMap

/**
 * Nikon's properties in movie mode (LiveViewSelector VIDEO). Nikon's movie format, size and frame
 * rate have no decoded properties yet.
 */
export const nikonMovieControlProperties = {
    shutterSpeed: [nikon.NikonMovieShutterSpeed, standard.ExposureTime],
    iso: [nikon.NikonMovieISO],
    aperture: [nikon.NikonMovieFNumber],
    exposureMode: [standard.ExposureProgramMode],
    exposureCompensation: [standard.ExposureBiasCompensation],
    meteringMode: [standard.ExposureMeteringMode],
    photoVideoMode: [nikonCamera.LiveViewSelector],
    whiteBalance: [nikon.NikonMovieWhiteBalance],
    colorTemperature: [nikon.NikonMovieWhiteBalanceKelvin],
    pictureStyle: [nikon.NikonMoviePictureControl],
    focusMode: [nikon.NikonMovieFocusMode],
    photoSize: [standard.ImageSize],
} as const satisfies ControlPropertyMap

/**
 * Nikon's words for the exposure settings, in photo and movie mode: the standard ones, plus its
 * automatic mode and highlight-weighted metering, which it reports as vendor values 0x8010.
 */
export const nikonControlValues = {
    ...standardControlValues,
    exposureMode: { canonical: lookup<ExposureMode>({ ...standardExposureModes, 'Mode 0x8010': 'Auto' }) },
    meteringMode: { canonical: lookup<MeteringMode>({ ...standardMeteringModes, '32784': 'Highlight' }) },
} as const satisfies ControlValueTable

type Names<Value extends string> = Readonly<Record<Value, string>>

const nikonFocusModes = {
    'AF-S': 'AF-S',
    'AF-C': 'AF-C',
    'AF-F': 'AF-F',
    Manual: 'MF',
} as const satisfies Names<NikonFocusModeLabel>

/** Nikon's vendor values of the standard FocusMode (0x8010–0x8013), next to the standard ones. */
const nikonStandardFocusModes = {
    ...standardFocusModes,
    'AF-S': 'AF-S',
    'AF-C': 'AF-C',
    'AF-A': 'AF-A',
    'AF-F': 'AF-F',
} as const satisfies Names<CodecType<typeof nikonCamera.FocusMode.codec>>

/** The canonical name of each Nikon value, per setting and property (see `sonyControlValueNames`). */
export const nikonPhotoControlValueNames = {
    focusMode: { NikonStillFocusMode: nikonFocusModes, FocusMode: nikonStandardFocusModes },
} as const satisfies ControlValueNameTable

export const nikonMovieControlValueNames = {
    focusMode: { NikonMovieFocusMode: nikonFocusModes },
} as const satisfies ControlValueNameTable
