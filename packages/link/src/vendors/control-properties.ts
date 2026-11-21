import type { CameraControlId } from '@camera/controls'

type ControlProperties = Partial<Record<CameraControlId, readonly string[]>>

/** Preference order is within one vendor and mode, never across vendors. */
export const sonyControlProperties = {
    shutterSpeed: ['ShutterSpeed'],
    iso: ['Iso'],
    aperture: ['Aperture', 'FNumber'],
    whiteBalance: ['WhiteBalance'],
    colorTemperature: ['ColorTemperature'],
    focusMode: ['FocusMode'],
    focusArea: ['FocusArea'],
    subjectRecognition: ['SubjectRecognitionInAF'],
    recognitionTarget: ['RecognitionTarget'],
    eyeSelect: ['RightLeftEyeSelect'],
    stillFormat: ['StillFileFormat', 'CompressionSetting'],
    imageSize: ['SonyImageSize'],
    aspectRatio: ['AspectRatio'],
    jpegQuality: ['JpegQuality'],
    movieFormat: ['MovieFileFormat'],
    movieSetting: ['MovieRecordingSetting'],
    movieFrameRate: ['MovieRecordingFrameRate'],
    zoomMode: ['ZoomSetting'],
    liveViewQuality: ['LiveViewImageQuality'],
    exposureProgram: ['ExposureProgramMode'],
} as const satisfies ControlProperties

export const canonControlProperties = {
    shutterSpeed: ['CanonShutterSpeed'],
    iso: ['CanonIso'],
    aperture: ['CanonAperture'],
    whiteBalance: ['CanonWhiteBalance'],
    colorTemperature: ['CanonColorTemperature'],
    focusMode: ['CanonFocusMode'],
    focusArea: ['CanonLiveViewAutofocusMode'],
    exposureProgram: ['CanonAutoExposureMode'],
    movieFormat: ['CanonMovieFormat'],
    stillFormat: ['CanonImageFormat', 'CanonImageFormatSd'],
} as const satisfies ControlProperties

export const standardControlProperties = {
    shutterSpeed: ['ExposureTime'],
    iso: ['ExposureIndex'],
    aperture: ['FNumber'],
    whiteBalance: ['WhiteBalance'],
    focusMode: ['FocusMode'],
    exposureProgram: ['ExposureProgramMode'],
    imageSize: ['ImageSize'],
} as const satisfies ControlProperties

export const nikonPhotoControlProperties = {
    ...standardControlProperties,
    shutterSpeed: ['NikonPhotoShutterSpeed', 'ExposureTime'],
    focusMode: ['NikonStillFocusMode', 'FocusMode'],
    colorTemperature: ['NikonWhiteBalanceKelvin'],
} as const satisfies ControlProperties

export const nikonMovieControlProperties = {
    ...standardControlProperties,
    shutterSpeed: ['NikonMovieShutterSpeed', 'ExposureTime'],
    iso: ['NikonMovieISO'],
    aperture: ['NikonMovieFNumber'],
    whiteBalance: ['NikonMovieWhiteBalance'],
    focusMode: ['NikonMovieFocusMode'],
    colorTemperature: ['NikonMovieWhiteBalanceKelvin'],
} as const satisfies ControlProperties
