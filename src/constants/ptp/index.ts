/**
 * PTP Constants Index
 * V7 Architecture - Type-safe with validation
 */

// Export all PTP constants
export * from './operations'
export * from './responses'
export * from './events'
export * from './properties'
export * from './formats'
export * from './storage'
export * from './container-types'

// Import for creating mappers
import { PTPOperations } from './operations'
import { PTPResponses } from './responses'
import { PTPEvents } from './events'
import { PTPProperties } from './properties'
import { PTPFormats } from './formats'
import { PTPStorageTypes } from './storage'

// Import mapper utilities
import { ConstantMapper, PropertyMapper } from '../utilities'

// Pre-instantiated mappers for PTP constants
export const PTPOperationMapper = new ConstantMapper(PTPOperations)
export const PTPResponseMapper = new ConstantMapper(PTPResponses)
export const PTPEventMapper = new ConstantMapper(PTPEvents)
export const PTPPropertyMapper = new PropertyMapper(PTPProperties)
export const PTPFormatMapper = new ConstantMapper(PTPFormats)
export const PTPStorageMapper = new ConstantMapper(PTPStorageTypes)