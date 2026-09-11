// Main protocol implementation
export { CanonCamera } from '@camera/canon-camera'
export { GenericCamera } from '@camera/generic-camera'
export { Camera } from '@camera/index'
export { NikonCamera } from '@camera/nikon-camera'
export { SonyCamera } from '@camera/sony-camera'

// Transport implementations
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
