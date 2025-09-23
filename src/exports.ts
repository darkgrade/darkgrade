/**
 * Common exports shared across all entry points
 */

// ============================================================================
// Client Layer - Primary API
// ============================================================================
export { Camera } from '@api/camera'
export { Photo } from '@api/photo'
export { Frame } from '@api/frame'

// ============================================================================
// Camera Layer
// ============================================================================
// Interfaces
export type { CameraInterface, CameraOptions, StorageInfo } from '@camera/interfaces/camera.interface'

// ============================================================================
// Core Layer
// ============================================================================
export type { ProtocolInterface } from '@core/protocol'
export type { MessageBuilderInterface } from '@core/messages'
export type { Operation, Response, Event } from '@constants/types'
export { MessageType } from '@constants/types'

// ============================================================================
// Transport Layer
// ============================================================================
export type { TransportInterface } from '@transport/interfaces/transport.interface'
export type {
    DeviceDescriptor,
    TransportOptions,
    DeviceSearchCriteria,
} from '@transport/interfaces/transport.interface'
export type {
    EndpointManagerInterface,
    EndpointConfiguration,
    DeviceFinderInterface,
} from '@transport/interfaces/transport.interface'
export { TransportType, EndpointType } from '@transport/interfaces/transport.interface'

// ============================================================================
// Constants
// ============================================================================
export { DataType } from '@constants/types'
export { ContainerTypes } from '@constants/ptp/containers'
export type { ContainerType } from '@constants/ptp/containers'
export type { PropertyDescriptor, Property, PropertyDefinitionShape } from '@constants/types'

// ============================================================================
// Errors
// ============================================================================
export { PTPError } from '@constants/ptp/errors'