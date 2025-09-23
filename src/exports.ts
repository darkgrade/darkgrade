/**
 * Common exports shared across all entry points
 */

// Client Layer - Primary API
export { Camera } from '@client/camera'
export { Photo } from '@client/photo'
export { Frame } from '@client/frame'
export type {
    CameraOptions
} from '@client/types'

// Property constants for advanced usage
export { DeviceProperty } from '@camera/properties/device-properties'

// Export interfaces for advanced users
export type { CameraInterface } from '@camera/interfaces/camera.interface'
export type { TransportInterface } from '@transport/interfaces/transport.interface'
export type { DeviceDescriptor, TransportType, TransportOptions } from '@transport/interfaces/device.interface'
export type { ProtocolInterface, Operation, Response, Event } from '@core/ptp-protocol'
// Export camera layer types
export type { StorageInfo } from '@camera/interfaces/camera.interface'
export type { ImageInfo, ImageData } from '@camera/interfaces/image.interface'
export { ImageFormat } from '@camera/interfaces/image.interface'
export type {
    LiveViewFrame,
    FrameMetadata,
    FocusInfo,
    FocusArea,
    ExposureInfo,
    WhiteBalanceInfo,
    FaceInfo,
} from '@camera/interfaces/liveview.interface'
export { FrameFormat, FocusStatus } from '@camera/interfaces/liveview.interface'

// Export core layer types
export type {
    MessageBuilderInterface,
    ParsedData,
    DataConverterInterface,
} from '@core/ptp-message-builder'
export { MessageType } from '@core/ptp-protocol'
export { DataType } from '@constants/types'

// Export transport layer types
export type {
    EndpointManagerInterface,
    EndpointConfiguration,
    DeviceFinderInterface,
} from '@transport/interfaces/endpoint.interface'
export type { DeviceSearchCriteria } from '@transport/interfaces/device.interface'
export { EndpointType } from '@transport/interfaces/endpoint.interface'