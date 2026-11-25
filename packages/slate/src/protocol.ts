/**
 * `@darkgrade/slate/protocol`: raw PTP access, vendor drivers, registries and vendor diagnostics,
 * for bench work. Unsupported: none of this is the public camera API, names follow each vendor's
 * own protocol, and results are not confirmed the way Camera operations are. Applications use
 * `Camera` from `@darkgrade/slate`.
 *
 * Wireless pairing (Sony Wi-Fi and its SDK, Nikon Wi-Fi, Bluetooth remotes) lives here unchanged
 * as a written exception until it becomes Camera.connect options.
 */

// The protocol session of a Camera: its driver, raw send/get/set and vendor diagnostics.
export { protocolSession } from '@camera/protocol-session'
export type { CanonLiveViewMagnification, LiveViewPanDirection, ProtocolSession } from '@camera/protocol-session'
export type { CameraDriverInstance } from '@camera/camera-context'

// Driver classes
export { CanonCamera } from '@vendors/canon/canon-camera'
export type { CanonNetworkState, CanonPropertyState, CanonRawEvent, CanonUnknownPropertyState } from '@vendors/canon/canon-camera'
export { GenericCamera } from '@vendors/generic/generic-camera'
export type { StandardPropertyState } from '@vendors/generic/generic-camera'
export { NikonCamera } from '@vendors/nikon/nikon-camera'
export type { NikonFocusResult, NikonFocusPointResult, NikonLiveViewMetadata } from '@vendors/nikon/nikon-camera'
export { SONY_CAMERA_BUTTONS, SonyCamera } from '@vendors/sony/sony-camera'
export type { SonyCameraButton, SonyOsdImage, SonyPropertyState, SonyZoomResult } from '@vendors/sony/sony-camera'
export { VendorExtensionCamera } from '@vendors/generic/vendor-extension-camera'
export type { CanonExtendedDeviceInfo } from '@vendors/canon/datasets/canon-extended-device-info-dataset'
export type { CanonLiveViewFrame } from '@vendors/canon/datasets/canon-live-view-dataset'

// Registries
export { getDatatypeByCode } from '@ptp/definitions/datatype-definitions'
export { genericEventRegistry } from '@ptp/definitions/event-definitions'
export { formatRegistry } from '@ptp/definitions/format-definitions'
export { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
export { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
export { responseRegistry } from '@ptp/definitions/response-definitions'
export { VendorIDs } from '@ptp/definitions/vendor-ids'
export { nikonOperationRegistry } from '@vendors/nikon/definitions/nikon-operation-definitions'
export { sonyEventRegistry } from '@vendors/sony/definitions/sony-event-definitions'
export { sonyFormatRegistry } from '@vendors/sony/definitions/sony-format-definitions'
export { sonyOperationRegistry } from '@vendors/sony/definitions/sony-operation-definitions'
export { sonyPropertyRegistry } from '@vendors/sony/definitions/sony-property-definitions'
export { sonyResponseRegistry } from '@vendors/sony/definitions/sony-response-definitions'
export { MovieShutterMode, MovieShutterAngle, ExternalDCIn } from '@vendors/nikon/video-properties'
export { NikonEventDataCodec } from '@vendors/nikon/event-data'
export type { NikonQueuedEvent } from '@vendors/nikon/event-data'

// Sony model comparison
export { compareSonyModels, sonyModelContracts } from '@vendors/sony/model-contracts'

// Vendor helpers that the generic operations will absorb; each slice moves its own.
export { SonyVideoRecording } from '@vendors/sony/video-recording'
export { SonyPtpVideoRecording } from '@vendors/sony/ptp-video-recording'
export { sonyPtpMovieCard } from '@vendors/sony/ptp-recording-card'
export { openCanonRecordingMode, withCanonRecordingMode, probeCanonRecordingControls } from '@vendors/canon/recording-mode'
export { sonyMovieCard, sonyMovieSlots } from '@vendors/sony/recording-slots'
export { parseSonyContentInfoList } from '@vendors/sony/content-info-list'
export type { SonyContent, SonyContentFile, SonyContentInfoList } from '@vendors/sony/content-info-list'
export { parseSonyFocalFrameInfo } from '@vendors/sony/focal-frame-info'
export type { SonyFocalFrame, SonyFocalFrameInfo, SonyFrameKind } from '@vendors/sony/focal-frame-info'
export { readNikonRecordingStatus } from '@vendors/nikon/recording-status'
export { prepareNikonManualExposure } from '@vendors/nikon/manual-exposure'
export { NikonShotControls } from '@vendors/nikon/shot-controls'
export { NikonMenuController, type NikonMenuKey, type NikonMenuRunOptions } from '@vendors/nikon/menu-controls'
export { NikonAccessoryController, encodeNikonAccessoryKey, encodeNikonAccessoryInfo } from '@vendors/nikon/accessory-controls'
export type {
    NikonAccessoryKey,
    NikonAccessoryState,
    NikonAccessoryInfo,
    NikonAccessorySoftwareConfirmationOptions,
} from '@vendors/nikon/accessory-controls'

// Wireless pairing: Sony Wi-Fi and its SDK
export { SonyWifiCamera, SONY_SDK_PROPERTY_CODES, validateSonyWifiAuthentication } from '@vendors/sony/sdk-camera'
export type {
    SonySdkBridge,
    SonySdkProperty,
    SonyWifiAuthentication,
    SonyBluetoothDirectAuthentication,
    SonyWifiCameraModel,
    SonyWirelessConnection,
} from '@vendors/sony/sdk-camera'
export { decodeSonyMonitoringFormat, sonyPreviewCapabilities } from '@vendors/sony/sdk-preview'
export type { SonyMonitoringFormat } from '@vendors/sony/sdk-preview'
export { createSonySdkBridge } from '@vendors/sony/sdk-node-bridge'
export type { SonySdkBridgeOptions } from '@vendors/sony/sdk-node-bridge'
export {
    SonyRemoteSdkTransport,
    type SonyRemoteSdkChannel,
    type SonyRemoteSdkChannelFactory,
    type SonyRemoteSdkConnectionOptions,
} from '@transport/sony-remote/sony-remote-sdk-transport'
export { sonyWifiKeyboardCharacter, typeSonyWifiKeyboard } from '@vendors/sony/wifi-keyboard'
export type { SonyKeyboardControls, SonyKeyboardImage } from '@vendors/sony/wifi-keyboard'

// Wireless pairing: Nikon Wi-Fi
export { pairNikonWifiProfile, decodeNikonPairingCode } from '@vendors/nikon/wifi-pairing'
export type { NikonWifiPairingOptions } from '@vendors/nikon/wifi-pairing'
export { readNikonWirelessStatus } from '@vendors/nikon/wireless-status'
export { connectNikonWifiCamera, type NikonWifiConnectionOptions } from '@vendors/nikon/wifi-camera'
export { requestNikonWifi, type NikonSmartDeviceChannel } from '@vendors/nikon/bluetooth-wifi'
export { discoverNikonWifiCameras, type NikonWifiAdvertisement } from '@vendors/nikon/wifi-discovery'

// Wireless pairing: Bluetooth remotes
export {
    SONY_BLUETOOTH_REMOTE_COMMAND,
    SONY_BLUETOOTH_REMOTE_NOTIFICATION,
    SONY_BLUETOOTH_REMOTE_SERVICE,
    SonyBluetoothRemote,
} from '@vendors/sony/bluetooth-remote'
export type { SonyBluetoothChannel, SonyBluetoothDirection } from '@vendors/sony/bluetooth-remote'
export {
    NikonBluetoothRemote,
    NIKON_BLUETOOTH_REMOTE_SERVICE,
    NIKON_BLUETOOTH_REMOTE_COMMAND,
} from '@vendors/nikon/bluetooth-remote'
export type { NikonBluetoothChannel, NikonBluetoothKey } from '@vendors/nikon/bluetooth-remote'
