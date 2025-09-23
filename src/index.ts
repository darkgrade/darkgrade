/**
 * @jpglab/fuse - Simplified Camera Control API
 */

// Client Layer - Primary API
export { Camera } from './client/camera'
export { listCameras, watchCameras } from './client/discovery'
export { Photo } from './client/photo'
export { Frame } from './client/frame'
export type {
    CameraOptions,
    CameraDescriptor,
    Photo as PhotoType,
    Frame as FrameType,
    ExposureMode,
} from './client/types'

// Property constants for advanced usage
export { DeviceProperty } from '@camera/properties/device-properties'

// Export interfaces for advanced users
export type { CameraInterface } from '@camera/interfaces/camera.interface'
export type { TransportInterface, DeviceIdentifier, TransportType } from '@transport/interfaces/transport.interface'
export type { ProtocolInterface, Operation, Response, Event } from '@core/interfaces/protocol.interface'
// Export camera layer types
export type { CameraInfo, StorageInfo } from '@camera/interfaces/camera.interface'
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

// Constants export - removed as they're not used in simplified API

// Export core layer types
export type {
    MessageBuilderInterface,
    ParsedResponse,
    ParsedEvent,
    ParsedData,
    DataConverterInterface,
} from '@core/interfaces/message-builder.interface'
export { MessageType, PTPDataType } from '@core/interfaces/message-builder.interface'

// Export transport layer types
export type {
    EndpointManagerInterface,
    EndpointConfiguration,
    DeviceFinderInterface,
    DeviceSearchCriteria,
    DeviceDescriptor,
} from '@transport/interfaces/endpoint.interface'
export { EndpointType } from '@transport/interfaces/endpoint.interface'
