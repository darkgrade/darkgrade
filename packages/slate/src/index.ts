export { runBenchmark } from '@workflows/telemetry-benchmark'
export type { BenchmarkCheck, BenchmarkOptions } from '@workflows/telemetry-benchmark'
export { recordFirstContact } from '@workflows/first-contact'
export { isValidatedModel, isVerifiedFeature, validatedCameraModels, verifiedFeatureModels } from '@camera/validated-models'
export type { VerifiedFeature } from '@camera/validated-models'
export { configureSlateTelemetry } from '@core/telemetry'
export { identifyCamera } from '@camera/identification/camera-identification'
export { observeCameraEvents } from '@workflows/camera-event-observation'
export { cameraControlContract, qualifyCameraSetting, qualificationSettings } from '@workflows/camera-qualification'
export type { QualificationCamera, QualificationSetting } from '@workflows/camera-qualification'
export type { CameraIdentification, CameraIdentityCandidate } from '@camera/identification/camera-identification'

// Main protocol implementation
export type { CameraRecoveryOptions, CameraRecoveryReport, CameraRecoveryStep } from '@vendors/generic/generic-camera'
export { Camera } from '@camera/index'
export { cameraControlDefinitions, resolveCameraControl } from '@camera/controls'
export { CameraConfirmationError } from '@camera/confirmation'
export {
    CameraClipNotFoundError,
    CameraOutcomeUnknownError,
    CameraRefusedError,
    CameraUnsupportedError,
} from '@camera/errors'
export type {
    Aperture,
    AspectRatio,
    AudioRecording,
    ColorTemperature,
    DetectionSubject,
    DigitalZoom,
    DriveMode,
    ExposureCompensation,
    ExposureMode,
    ExposureModeAlias,
    EyeSelection,
    FlashMode,
    FocusArea,
    FocusMode,
    FrameRate,
    Iso,
    JpegQuality,
    LiveViewQuality,
    MeteringMode,
    PhotoFormat,
    PhotoSize,
    PhotoVideoMode,
    PictureProfile,
    PictureStyle,
    RawCompression,
    ShutterSpeed,
    SubjectDetection,
    ContinuousAutofocus,
    VideoFormat,
    VideoQuality,
    WhiteBalance,
} from '@camera/settings/values'
export type { FocusDirection, FocusNudge, FocusResult, FocusStepSize } from '@camera/driver'
export type { CardPhoto, ComputerPhoto, Photo, PhotoDestination, TakePhotoOptions } from '@camera/driver'
export type { Clip } from '@camera/driver'
export type { FocusFrame, LiveViewFrame, LiveViewFrameOptions, LiveViewOverlay } from '@camera/driver'
export type { ZoomDirection, ZoomOptions, ZoomSpeed } from '@camera/driver'
export type { SettingInput, SettingValue, TypedSettingId, TypedSettingMethods } from '@camera/settings/typed-settings'
export type { CameraRecordingState, OperationAvailability } from '@camera/controls'
export type { CardStatus, MediaDownloadOptions, MediaItem, MediaPreviewSize } from '@camera/driver'
export type { Battery } from '@camera/driver'
export type { CameraEventHandler, CameraEventName } from '@camera/driver'
export type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState, CameraControlSession, UnrecognizedValues } from '@camera/controls'
export type { CameraLens } from '@camera/controls'
export { parseExposureTime, exposureSeconds, matchExposureTime } from '@camera/exposure-time'
export type { ExposureTime, ExposureTimeInput, ExposureContext } from '@camera/exposure-time'
export type { CameraOptions } from '@camera/index'
export type { CameraInfo, ConnectOptions, DiscoveredCamera, RecoveryReport } from '@camera/driver'
export type { DeviceDescriptor } from '@transport/interfaces/device.interface'
export type { TransportInterface } from '@transport/interfaces/transport.interface'
export type { OperationParams, OperationResponse, EventParams } from '@ptp/types/type-helpers'
export { DEFAULT_TRANSACTION_POLICY, type TransactionPolicy } from '@ptp/transaction-channel'
export {
    PTPDecodeError,
    PTPDisconnectedError,
    PTPError,
    PTPProtocolError,
    PTPRecoveryRequiredError,
    PTPResponseError,
    PTPTimeoutError,
    type PTPProtocolViolation,
} from '@core/ptp-errors'

// Logger configuration
export { defaultLoggerConfig } from '@core/logger-config'
export type { LoggerConfig } from '@core/logger-config'

// Vendor-named drivers, registries, transports and diagnostics are in @darkgrade/slate/protocol (src/protocol.ts).
export {VideoTake} from '@workflows/video-take'
export type {VideoTakeState,TakeCamera,TakeCameraState,TakeMedia} from '@workflows/video-take'
export {analyseShot,measureShot,describeShot,subjectFocusVerified,chooseIso,chooseShutterSpeed,exifIso} from '@workflows/shot-analysis'
export type {ShotAnalysis,ShotMetrics} from '@workflows/shot-analysis'
export {optimiseShot} from '@workflows/shot-setup'
export type {ShotSetupReport,ShotProperty} from '@workflows/shot-setup'

export {assessCameraPower} from '@workflows/camera-power'
export type {CameraPower, CameraPowerAssessment} from '@workflows/camera-power'
export {normalizeCameraPower,readStandardCameraPower,readCameraPower} from '@vendors/camera-power'

