/** Pure control vocabulary and value conversions, safe for browser renderers. */
export { cameraControlDefinitions, resolveCameraControl, unrecognizedValueLabel } from '@camera/controls'
export { CameraConfirmationError } from '@camera/confirmation'
export {
    CameraClipNotFoundError,
    CameraOutcomeUnknownError,
    CameraRefusedError,
    CameraUnsupportedError,
} from '@camera/errors'
export { formatShutterSpeed, type ShutterSpeed } from '@camera/settings/shutter-speed'
export {
    exposureModes,
    meteringModes,
    type Aperture,
    type ExposureCompensation,
    type ExposureMode,
    type ExposureModeAlias,
    type Iso,
    type MeteringMode,
} from '@camera/settings/exposure'
export type { ColorTemperature, PictureProfile, PictureStyle, WhiteBalance } from '@camera/settings/colour'
export type { DriveMode, PhotoVideoMode } from '@camera/settings/mode'
export type { DetectionSubject, EyeSelection, FocusArea, FocusMode, SubjectDetection } from '@camera/settings/focus'
export type { DigitalZoom } from '@camera/settings/video'
export type { LiveViewQuality } from '@camera/settings/live-view'
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
