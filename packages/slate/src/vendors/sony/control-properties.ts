import {
    formatExposureCompensation,
    liveViewValueNames,
    videoValueNames,
    type ExposureMode,
    type MeteringMode,
} from '@camera/settings/values'
import type { CodecType } from '@ptp/types/codec'
import * as standard from '@ptp/definitions/property-definitions'
import type {
    ControlPropertyMap,
    ControlValueNameTable,
    ControlValueTable,
    ControlValueVocabulary,
} from '@vendors/control-properties'
import { fNumberLabel, isoLabel, lookup } from '@vendors/generic/control-properties'
import * as sony from '@vendors/sony/definitions/sony-property-definitions'
import type { SonyFocusAreaName } from '@vendors/sony/definitions/sony-property-definitions'

/**
 * Sony's properties: for each canonical id, the properties that carry it in preference order.
 * Typed definitions, so each setting's value type is derived from the codecs (see `CodecValue`).
 *
 * photoVideoMode is the photo and movie halves of the exposure program, composed in
 * `@vendors/photo-video-mode`.
 *
 * Sony's AudioRecording (0xd0d2) is not mapped: its value meanings are undocumented, and on the
 * a7 V (2026-11-24) a take recorded with raw 0 still carried a sound track, like one with raw 1.
 * Until the meaning is measured from the audio samples or documented, audioRecording is
 * unsupported on Sony rather than a confirmed "Off" that may still record sound.
 */
export const sonyControlProperties = {
    shutterSpeed: [sony.ShutterSpeed],
    iso: [sony.Iso],
    aperture: [sony.Aperture, standard.FNumber],
    exposureMode: [standard.ExposureProgramMode],
    exposureCompensation: [sony.ExposureBiasCompensation, sony.ExposureCompensation],
    meteringMode: [sony.ExposureMeteringMode],
    driveMode: [sony.StillCaptureMode],
    whiteBalance: [sony.WhiteBalance],
    colorTemperature: [sony.ColorTemperature],
    // Bodies from 2020 on have Creative Look; older ones Creative Style.
    pictureStyle: [sony.CreativeLook, sony.CreativeStyle],
    pictureProfile: [sony.PictureProfile],
    focusMode: [sony.FocusMode],
    focusArea: [sony.FocusArea],
    subjectDetection: [sony.SubjectRecognitionInAF],
    detectionSubject: [sony.RecognitionTarget],
    eyeSelection: [sony.RightLeftEyeSelect],
    photoFormat: [sony.StillFileFormat, sony.CompressionSetting],
    photoSize: [sony.SonyImageSize],
    aspectRatio: [sony.AspectRatio],
    jpegQuality: [sony.JpegQuality],
    flashMode: [sony.FlashMode],
    videoFormat: [sony.MovieFileFormat],
    videoQuality: [sony.MovieRecordingSetting],
    frameRate: [sony.MovieRecordingFrameRate],
    digitalZoom: [sony.ZoomSetting],
    liveViewQuality: [sony.LiveViewImageQuality],
} as const satisfies ControlPropertyMap

/** A signed stop count, with or without Sony's `EV` suffix (`+0.3 EV`, `-1`, `0.7`). */
const signedStops = (label: string) => {
    const match = /^([+-]?\d+(?:\.\d+)?)(?:\s*EV)?$/i.exec(label.trim())
    return match ? formatExposureCompensation(Number(match[1])) : undefined
}

/**
 * Sony PTP exposure programs: a family prefix (photo, `Movie `, `S&Q `, `Interval Movie `) and a
 * mode. Only the current family's modes are offered: changing family is photo/video, not exposure.
 */
const sonyFamilies = ['Interval Movie ', 'Movie / S&Q ', 'Movie ', 'S&Q '] as const
const sonyModes = lookup<ExposureMode>({
    Manual: 'Manual',
    'Program Auto': 'Program',
    'Aperture Priority': 'Aperture priority',
    'Shutter Priority': 'Shutter priority',
    Auto: 'Auto',
    'Flexible Exposure': 'Flexible priority',
})
const sonyExposureMode: ControlValueVocabulary = {
    canonical: label => sonyModes(label.replace(new RegExp(`^(?:${sonyFamilies.join('|')})`), '')),
    family: label => sonyFamilies.find(family => label.startsWith(family)) ?? 'photo',
}

/** Sony Camera Remote SDK ExposureProgramMode labels (`M Manual`, `Movie A`, `SQMotion S`, ...). */
const sonySdkFamilies = ['Movie SQMotion ', 'HiFrameRate ', 'SQMotion ', 'Movie '] as const
const sonySdkModes = lookup<ExposureMode>({
    'M Manual': 'Manual',
    M: 'Manual',
    'P Auto': 'Program',
    P: 'Program',
    'A AperturePriority': 'Aperture priority',
    A: 'Aperture priority',
    'S ShutterSpeedPriority': 'Shutter priority',
    S: 'Shutter priority',
    Auto: 'Auto',
    AUTO: 'Auto',
    F: 'Flexible priority',
    'F Mode': 'Flexible priority',
})
const sonySdkExposureMode: ControlValueVocabulary = {
    canonical: label => sonySdkModes(label.replace(new RegExp(`^(?:${sonySdkFamilies.join('|')})`), '')),
    family: label => sonySdkFamilies.find(family => label.startsWith(family)) ?? 'photo',
}

const sonyMetering = lookup<MeteringMode>({
    Multi: 'Multi',
    Center: 'Center-weighted',
    'Entire Screen Avg.': 'Average',
    'Spot: Standard': 'Spot',
    'Spot: Large': 'Large spot',
    Highlight: 'Highlight',
})

/**
 * Sony SDK CrMeteringMode values 5–10, the ones the bench matched to PTP 0x8001–0x8006 (see the Sony
 * ExposureMeteringMode codec); 1–4 duplicate them in the SDK header and are left unnamed.
 */
const sonySdkMetering = lookup<MeteringMode>({
    '5': 'Multi',
    '6': 'Center-weighted',
    '7': 'Average',
    '8': 'Spot',
    '9': 'Large spot',
    '10': 'Highlight',
})

/**
 * Sony's words for the exposure settings, mapped to the canonical names of `@camera/settings/values`.
 * A word with no canonical name is left out of the choices and never written; a current value with
 * none reads as unrecognized.
 */
export const sonyControlValues = {
    aperture: { canonical: fNumberLabel },
    iso: { canonical: isoLabel },
    exposureMode: sonyExposureMode,
    exposureCompensation: { canonical: signedStops },
    meteringMode: { canonical: sonyMetering },
} as const satisfies ControlValueTable

/** The same settings on a Sony Camera Remote SDK session. */
export const sonySdkControlValues = {
    aperture: { canonical: fNumberLabel },
    iso: { canonical: label => isoLabel(/^\d/.test(label) ? `ISO ${label}` : label) },
    exposureMode: sonySdkExposureMode,
    exposureCompensation: { canonical: signedStops },
    meteringMode: { canonical: sonySdkMetering },
} as const satisfies ControlValueTable

type Names<Value extends string> = Readonly<Record<Value, string>>

const onOff = { Off: 'Off', On: 'On' } as const satisfies Names<CodecType<typeof sony.SubjectRecognitionInAF.codec>>

const sonyFocusModes = {
    Manual: 'MF',
    'AF-S': 'AF-S',
    'AF-C': 'AF-C',
    'AF-A': 'AF-A',
    DMF: 'DMF',
    'Manual Reverse': 'MF reverse',
    'AF-D': 'AF-D',
    'Preset Focus': 'Preset focus',
} as const satisfies Names<CodecType<typeof sony.FocusMode.codec>>

/** Sony's Flexible Spot is a spot (Canon's word too); Lock-on AF is tracking (Sony's newer menus). */
const sonyFocusAreas = {
    Wide: 'Wide',
    Zone: 'Zone',
    Center: 'Center',
    'Flexible Spot S': 'Spot S',
    'Flexible Spot M': 'Spot M',
    'Flexible Spot L': 'Spot L',
    'Expand Flexible Spot': 'Expanded Spot',
    'Flexible Spot': 'Spot',
    'Flexible Spot XS': 'Spot XS',
    'Flexible Spot XL': 'Spot XL',
    'Flexible Spot Free Size 1': 'Spot Free Size 1',
    'Flexible Spot Free Size 2': 'Spot Free Size 2',
    'Flexible Spot Free Size 3': 'Spot Free Size 3',
    'Lock on AF Wide': 'Tracking Wide',
    'Lock on AF Zone': 'Tracking Zone',
    'Lock on AF Center': 'Tracking Center',
    'Lock on AF Flexible Spot S': 'Tracking Spot S',
    'Lock on AF Flexible Spot M': 'Tracking Spot M',
    'Lock on AF Flexible Spot L': 'Tracking Spot L',
    'Lock on AF Expand Flexible Spot': 'Tracking Expanded Spot',
    'Lock on AF Flexible Spot': 'Tracking Spot',
    'Lock on AF Flexible Spot XS': 'Tracking Spot XS',
    'Lock on AF Flexible Spot XL': 'Tracking Spot XL',
    'Lock on AF Flexible Spot Free Size 1': 'Tracking Spot Free Size 1',
    'Lock on AF Flexible Spot Free Size 2': 'Tracking Spot Free Size 2',
    'Lock on AF Flexible Spot Free Size 3': 'Tracking Spot Free Size 3',
    'Tracking Flexible Spot S': 'Tracking Spot S',
    'Tracking Flexible Spot M': 'Tracking Spot M',
    'Tracking Flexible Spot L': 'Tracking Spot L',
    'Tracking Expand Flexible Spot': 'Tracking Expanded Spot',
} as const satisfies Names<SonyFocusAreaName>

const sonyDetectionSubjects = {
    Person: 'People',
    'Animal + Bird': 'Animals and birds',
    Animal: 'Animals',
    Bird: 'Birds',
    Insect: 'Insects',
    'Car/Train': 'Cars and trains',
    Plane: 'Planes',
    Auto: 'Auto',
} as const satisfies Names<CodecType<typeof sony.RecognitionTarget.codec>>

const sonyEyes = {
    Auto: 'Auto',
    'Right Eye': 'Right',
    'Left Eye': 'Left',
} as const satisfies Names<CodecType<typeof sony.RightLeftEyeSelect.codec>>

/**
 * The canonical name of each Sony value, per setting and property. The keys of each table are its
 * codec's names (checked against the codec), the values are what `getCapabilities` reports and
 * `setControl` accepts. A value missing from a table keeps the camera's own label, and the typed
 * getters refuse to name it. The digital zoom and live-view tables live with their browser-safe
 * vocabularies in `@camera/settings/values`.
 */
export const sonyControlValueNames = {
    focusMode: { FocusMode: sonyFocusModes },
    focusArea: { FocusArea: sonyFocusAreas },
    subjectDetection: { SubjectRecognitionInAF: onOff },
    detectionSubject: { RecognitionTarget: sonyDetectionSubjects },
    eyeSelection: { RightLeftEyeSelect: sonyEyes },
    digitalZoom: videoValueNames,
    liveViewQuality: liveViewValueNames,
} as const satisfies ControlValueNameTable
