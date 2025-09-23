/**
 * Sony Vendor Extensions Index
 * V7 Architecture - Type-safe with validation
 */

// Export all Sony constants
export * from './properties'
export * from './operations'
export * from './events'
export * from './responses'
export * from './controls'

// Import for creating mappers
import { SonyProperties } from './properties'
import { SonyOperations } from './operations'
import { SonyEvents } from './events'
import { SonyResponses } from './responses'
import { SonyControls } from './controls'

// Import mapper utilities
import { ConstantMapper, PropertyMapper, ControlMapper } from '../../utilities'

// Pre-instantiated mappers for Sony constants
export const SonyPropertyMapper = new PropertyMapper(SonyProperties)
export const SonyOperationMapper = new ConstantMapper(SonyOperations)
export const SonyEventMapper = new ConstantMapper(SonyEvents)
export const SonyResponseMapper = new ConstantMapper(SonyResponses)
export const SonyControlMapper = new ControlMapper(SonyControls)