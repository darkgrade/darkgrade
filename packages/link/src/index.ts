export { identifyCamera } from '@camera/identification/camera-identification'
export { observeCameraEvents } from '@workflows/camera-event-observation'
export { compareSonyModels, sonyModelContracts } from '@vendors/sony/model-contracts'
export { cameraControlContract, qualifyCameraSetting, qualificationSettings } from '@workflows/camera-qualification'
export type { QualificationCamera, QualificationSetting } from '@workflows/camera-qualification'
export type { CameraIdentification, CameraIdentityCandidate } from '@camera/identification/camera-identification'

// Main protocol implementation
export { CanonCamera } from '@camera/canon-camera'
export { GenericCamera } from '@camera/generic-camera'
export { Camera } from '@camera/index'
export { inspectMovieTrackHandlers, readCameraMovieAudio } from '@camera/movie-audio'
export type { CameraMovieAudio } from '@camera/movie-audio'
export { NikonCamera } from '@camera/nikon-camera'
export type { CanonRawEvent } from '@camera/canon-camera'
export type { NikonFocusResult, NikonFocusPointResult, NikonLiveViewMetadata } from '@camera/nikon-camera'
export { SonyCamera } from '@camera/sony-camera'
export { DEFAULT_TRANSACTION_POLICY, type TransactionPolicy } from '@camera/transaction-channel'
export { VendorExtensionCamera } from '@camera/vendor-extension-camera'
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
export type { CanonExtendedDeviceInfo } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
export type { CanonLiveViewFrame } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'

// Transport implementations
export { TransportType } from '@transport/interfaces/transport-types'
export { IPTransport, PTPIPTransactionCancelledError } from '@transport/ip/ip-transport'
export type { IPTransportOptions } from '@transport/ip/ip-transport'
export {
    SonyRemoteSdkTransport,
    type SonyRemoteSdkChannel,
    type SonyRemoteSdkChannelFactory,
    type SonyRemoteSdkConnectionOptions,
} from '@transport/sony-remote/sony-remote-sdk-transport'
export { TransportFactory } from '@transport/transport-factory'
export { USBTransport } from '@transport/usb/usb-transport'

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

// Vendor extension registries
export { nikonOperationRegistry } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
export { sonyEventRegistry } from '@ptp/definitions/vendors/sony/sony-event-definitions'
export { sonyFormatRegistry } from '@ptp/definitions/vendors/sony/sony-format-definitions'
export { sonyOperationRegistry } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
export { sonyPropertyRegistry } from '@ptp/definitions/vendors/sony/sony-property-definitions'
export { sonyResponseRegistry } from '@ptp/definitions/vendors/sony/sony-response-definitions'

export { sonyWifiKeyboardCharacter, typeSonyWifiKeyboard } from '@vendors/sony/wifi-keyboard'
export type { SonyKeyboardControls, SonyKeyboardImage } from '@vendors/sony/wifi-keyboard'

export { SonyWifiCamera, SONY_SDK_PROPERTY_CODES, validateSonyWifiAuthentication } from '@vendors/sony/sdk-camera'
export type {
    SonySdkBridge,
    SonySdkProperty,
    SonyWifiAuthentication,
    SonyBluetoothDirectAuthentication,
} from '@vendors/sony/sdk-camera'
export { decodeSonyMonitoringFormat, sonyPreviewCapabilities } from '@vendors/sony/sdk-preview'
export type { SonyMonitoringFormat } from '@vendors/sony/sdk-preview'
export { createSonySdkBridge } from '@vendors/sony/sdk-node-bridge'
export type { SonySdkBridgeOptions } from '@vendors/sony/sdk-node-bridge'

export {
    SONY_BLUETOOTH_REMOTE_COMMAND,
    SONY_BLUETOOTH_REMOTE_NOTIFICATION,
    SONY_BLUETOOTH_REMOTE_SERVICE,
    SonyBluetoothRemote,
} from '@vendors/sony/bluetooth-remote'
export type { SonyBluetoothChannel, SonyBluetoothDirection } from '@vendors/sony/bluetooth-remote'

export {VideoTake} from '@workflows/video-take'
export type {VideoTakeState,TakeCamera,TakeCameraState,TakeMedia} from '@workflows/video-take'
export {UsbVideoRecording} from '@camera/video-recording'
export {SonyVideoRecording} from '@vendors/sony/video-recording'
export {openCanonRecordingMode,withCanonRecordingMode,probeCanonRecordingControls,restrictToRecordingChoices} from '@vendors/canon/recording-mode'
export {sonyMovieCard,sonyMovieSlots} from '@vendors/sony/recording-slots'

export {analyseShot,measureShot,describeShot,subjectFocusVerified,chooseIso,chooseShutterSpeed,exifIso} from '@workflows/shot-analysis'
export type {ShotAnalysis,ShotMetrics} from '@workflows/shot-analysis'
export {optimiseShot} from '@workflows/shot-setup'
export type {ShotSetupReport,ShotProperty} from '@workflows/shot-setup'
export {normaliseShotControls} from '@workflows/shot-controls'

export {pairNikonWifiProfile,decodeNikonPairingCode} from '@vendors/nikon/wifi-pairing'
export type {NikonWifiPairingOptions} from '@vendors/nikon/wifi-pairing'
export {readNikonWirelessStatus} from '@vendors/nikon/wireless-status'
export {assessCameraPower} from '@workflows/camera-power'
export type {CameraPower, CameraPowerAssessment} from '@workflows/camera-power'
export {normalizeCameraPower,readStandardCameraPower,readCameraPower} from '@vendors/camera-power'
export {readNikonRecordingStatus} from '@vendors/nikon/recording-status'

export {connectNikonWifiCamera,type NikonWifiConnectionOptions} from '@vendors/nikon/wifi-camera'
export {requestNikonWifi, type NikonSmartDeviceChannel} from '@vendors/nikon/bluetooth-wifi'
export {discoverNikonWifiCameras,type NikonWifiAdvertisement} from '@vendors/nikon/wifi-discovery'
export {NikonMenuController,type NikonMenuKey,type NikonMenuRunOptions} from '@vendors/nikon/menu-controls'
export {NikonAccessoryController,encodeNikonAccessoryKey,encodeNikonAccessoryInfo} from '@vendors/nikon/accessory-controls'
export type {NikonAccessoryKey,NikonAccessoryState,NikonAccessoryInfo,NikonAccessorySoftwareConfirmationOptions} from '@vendors/nikon/accessory-controls'
export {MovieShutterMode,MovieShutterAngle,ExternalDCIn} from '@vendors/nikon/video-properties'

export {prepareNikonManualExposure} from '@vendors/nikon/manual-exposure'

export {NikonShotControls} from '@vendors/nikon/shot-controls'

export {NikonBluetoothRemote,NIKON_BLUETOOTH_REMOTE_SERVICE,NIKON_BLUETOOTH_REMOTE_COMMAND} from '@vendors/nikon/bluetooth-remote'
export type {NikonBluetoothChannel,NikonBluetoothKey} from '@vendors/nikon/bluetooth-remote'

export { NikonEventDataCodec } from '@vendors/nikon/event-data'
export type { NikonQueuedEvent } from '@vendors/nikon/event-data'
