export { runBenchmark, runCameraBenchmark } from '@workflows/telemetry-benchmark'
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
export type { CameraRecoveryOptions, CameraRecoveryReport, CameraRecoveryStep } from '@camera/generic-camera'
export { Camera } from '@camera/index'
export { cameraControlDefinitions, resolveCameraControl } from '@camera/controls'
export { CameraConfirmationError } from '@camera/confirmation'
export { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
export type { ShutterSpeed } from '@camera/settings/shutter-speed'
export type { SettingInput, SettingValue, TypedSettingId, TypedSettingMethods } from '@camera/settings/typed-settings'
export type { CameraRecordingState } from '@camera/controls'
export type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState, CameraControlSession, UnrecognizedValues } from '@camera/controls'
export { parseExposureTime, exposureSeconds, matchExposureTime } from '@camera/exposure-time'
export type { ExposureTime, ExposureTimeInput, ExposureContext } from '@camera/exposure-time'
export type { CameraOptions } from '@camera/index'
export type { CameraInfo, ConnectOptions, DiscoveredCamera, RecoveryReport } from '@camera/driver/connection'
export type { DeviceDescriptor } from '@transport/interfaces/device.interface'
export type { TransportInterface } from '@transport/interfaces/transport.interface'
export type { OperationParams, OperationResponse, EventParams } from '@ptp/types/type-helpers'
export { inspectMovieTrackHandlers, readCameraMovieAudio } from '@camera/movie-audio'
export type { CameraMovieAudio } from '@camera/movie-audio'
export { isMovableFocusArea } from '@camera/sony-camera'
export { DEFAULT_TRANSACTION_POLICY, type TransactionPolicy } from '@camera/transaction-channel'
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
// Transport implementations
export { TransportType } from '@transport/interfaces/transport-types'
export { IPTransport, PTPIPTransactionCancelledError } from '@transport/ip/ip-transport'
export type { IPTransportOptions } from '@transport/ip/ip-transport'
export { TransportFactory } from '@transport/transport-factory'
export { USBTransport } from '@transport/usb/usb-transport'
export { recordFullTransport } from '@transport/recording-transport'
export type { TransportRecordingEntry, TransportRecordingOptions } from '@transport/recording-transport'

// Logger configuration
export { defaultLoggerConfig } from '@core/logger-config'
export type { LoggerConfig } from '@core/logger-config'

// Core type definitions
export * from '@ptp/types/codec'
export * from '@ptp/types/datatype'
export * from '@ptp/types/event'
export * from '@ptp/types/operation'
export * from '@ptp/types/parameter'
export * from '@ptp/types/property'
export * from '@ptp/types/response'

// Definition registries (single source of truth)
export { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
export { genericEventRegistry } from '@ptp/definitions/event-definitions'
export { formatRegistry } from '@ptp/definitions/format-definitions'
export { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
export { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
export { responseRegistry } from '@ptp/definitions/response-definitions'
export { VendorIDs } from '@ptp/definitions/vendor-ids'

// Data sets (PTP datasets with codecs)
export * from '@ptp/datasets/device-info-dataset'
export * from '@ptp/datasets/object-info-dataset'
export * from '@ptp/datasets/storage-info-dataset'

// Vendor-named drivers, registries and diagnostics are in @darkgrade/slate/protocol (src/protocol.ts).
export {VideoTake} from '@workflows/video-take'
export type {VideoTakeState,TakeCamera,TakeCameraState,TakeMedia} from '@workflows/video-take'
export {UsbVideoRecording} from '@camera/video-recording'
export { restrictToRecordingChoices } from '@vendors/canon/recording-mode'
export {analyseShot,measureShot,describeShot,subjectFocusVerified,chooseIso,chooseShutterSpeed,exifIso} from '@workflows/shot-analysis'
export type {ShotAnalysis,ShotMetrics} from '@workflows/shot-analysis'
export {optimiseShot} from '@workflows/shot-setup'
export type {ShotSetupReport,ShotProperty} from '@workflows/shot-setup'
export {normaliseShotControls} from '@workflows/shot-controls'

export {assessCameraPower} from '@workflows/camera-power'
export type {CameraPower, CameraPowerAssessment} from '@workflows/camera-power'
export {normalizeCameraPower,readStandardCameraPower,readCameraPower} from '@vendors/camera-power'

