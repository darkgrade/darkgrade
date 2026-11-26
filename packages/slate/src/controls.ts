/** Pure control vocabulary and value conversions, safe for browser renderers. */
export { cameraControlDefinitions, resolveCameraControl, unrecognizedValueLabel } from '@camera/controls'
export { CameraConfirmationError } from '@camera/confirmation'
export {
    CameraClipNotFoundError,
    CameraOutcomeUnknownError,
    CameraRefusedError,
    CameraUnsupportedError,
} from '@camera/errors'
export {
    exposureModes,
    formatShutterSpeed,
    meteringModes,
    type Aperture,
    type ColorTemperature,
    type DetectionSubject,
    type DigitalZoom,
    type DriveMode,
    type ExposureCompensation,
    type ExposureMode,
    type ExposureModeAlias,
    type EyeSelection,
    type FocusArea,
    type FocusMode,
    type Iso,
    type LiveViewQuality,
    type MeteringMode,
    type PhotoVideoMode,
    type PictureProfile,
    type PictureStyle,
    type ShutterSpeed,
    type SubjectDetection,
    type ContinuousAutofocus,
    type WhiteBalance,
} from '@camera/settings/values'
export type { SettingInput, SettingValue, TypedSettingId, TypedSettingMethods } from '@camera/settings/typed-settings'
export type {
    CameraCapabilities,
    CameraControlId,
    CameraControlInputs,
    CameraControlSession,
    CameraControlState,
    CameraLens,
    CameraRecordingState,
    OperationAvailability,
    UnrecognizedValues,
} from '@camera/controls'
export { exposureSeconds, matchExposureTime, parseExposureTime } from '@camera/exposure-time'
export type { ExposureContext, ExposureTime, ExposureTimeInput } from '@camera/exposure-time'
