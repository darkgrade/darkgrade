/**
 * Consolidated type definitions for PTP protocol
 * All core types, runtime interfaces, and definition shapes
 */

// ============================================================================
// Basic Types
// ============================================================================

/**
 * Hex code type for all PTP codes
 */
export type HexCode = number

/**
 * Data types supported by PTP
 */
export const DataType = {
  UINT8: 0x0001,
  INT8: 0x0002,
  UINT16: 0x0003,
  INT16: 0x0004,
  UINT32: 0x0005,
  INT32: 0x0006,
  UINT64: 0x0007,
  INT64: 0x0008,
  UINT128: 0x0009,
  INT128: 0x000A,
  ARRAY_UINT8: 0x4001,
  ARRAY_INT8: 0x4002,
  ARRAY_UINT16: 0x4003,
  ARRAY_INT16: 0x4004,
  ARRAY_UINT32: 0x4005,
  ARRAY_INT32: 0x4006,
  ARRAY_UINT64: 0x4007,
  ARRAY_INT64: 0x4008,
  STRING: 0xFFFF,
} as const

export type DataTypeValue = typeof DataType[keyof typeof DataType]

/**
 * Property form types
 */
export const PropertyForm = {
  NONE: 0x00,
  RANGE: 0x01,
  ENUM: 0x02,
} as const

export type PropertyFormValue = typeof PropertyForm[keyof typeof PropertyForm]

/**
 * Property access types
 */
export const PropertyAccess = {
  READ_ONLY: 0x00,
  READ_WRITE: 0x01,
} as const

export type PropertyAccessValue = typeof PropertyAccess[keyof typeof PropertyAccess]

/**
 * Message type enumeration
 */
export enum MessageType {
  COMMAND = 1,
  DATA = 2,
  RESPONSE = 3,
  EVENT = 4,
}

// ============================================================================
// Runtime Types (for actual data instances)
// ============================================================================

/**
 * PTP Operation - runtime instance
 */
export interface Operation {
  code: number
  parameters?: number[]
  data?: Uint8Array
  hasDataPhase?: boolean
  maxDataLength?: number
}

/**
 * PTP Response - runtime instance
 */
export interface Response {
  code: number
  sessionId: number
  transactionId: number
  parameters?: number[]
  data?: Uint8Array
  raw?: Uint8Array
  type?: MessageType
}

/**
 * PTP Event - runtime instance
 */
export interface Event {
  code: number
  sessionId: number
  transactionId: number
  parameters?: number[]
}

/**
 * Property descriptor for allowed values
 */
export interface PropertyDescriptor<T> {
  current?: T
  default?: T
  form: PropertyFormValue
  min?: T
  max?: T
  step?: T
  allowedValues?: T[]
}

// ============================================================================
// Definition Types (for constant definitions)
// ============================================================================

/**
 * Operation definition for PTP operation constants
 */
export type OperationDefinition = Record<string, {
  code: HexCode
  description: string
  parameters?: Array<{
    name: string
    type: DataTypeValue
    description: string
  }>
  dataIn?: boolean
  dataOut?: boolean
  dataDescription?: string
}>

/**
 * Response definition for PTP response constants
 */
export type ResponseDefinition = Record<string, {
  name: string
  code: HexCode
  description: string
  recoverable?: boolean
}>

/**
 * Event definition for PTP event constants
 */
export type EventDefinition = Record<string, {
  code: HexCode
  description: string
  parameters?: Array<{
    name: string
    type: DataTypeValue
    description: string
  }>
}>

/**
 * Property definition type
 */
export interface Property {
  name: string
  code: HexCode
  type: DataTypeValue
  unit?: string
  description: string
  writable?: boolean
  descriptor?: PropertyDescriptor<any>
  enum?: Record<string, HexCode>
  encode?: (value: any) => HexCode | Uint8Array
  decode?: (value: HexCode | Uint8Array) => any
}

/**
 * Property definition for PTP property constants
 */
export type PropertyDefinition = Record<string, Property>

/**
 * Storage type definition
 */
export type StorageDefinition = Record<string, {
  name: string
  code: HexCode
  description: string
}>

/**
 * Format definition
 */
export type FormatDefinition = Record<string, {
  name: string
  code: HexCode
  description: string
  fileExtension?: string
  mimeType?: string
}>

/**
 * Control definition (for Sony controls)
 */
export type ControlDefinition = Record<string, {
  property: HexCode
  value: HexCode
  description: string
  holdable?: boolean
}>

// ============================================================================
// Backwards Compatibility Aliases (will be removed in future)
// ============================================================================

export type OperationDefinitionShape = OperationDefinition
export type ResponseDefinitionShape = ResponseDefinition
export type EventDefinitionShape = EventDefinition
export type PropertyDefinitionShape = PropertyDefinition