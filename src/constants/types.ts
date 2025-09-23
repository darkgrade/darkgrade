/**
 * Core type definitions for PTP constants
 * V7 Architecture - Type-safe with validation
 */

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

export type DataType = typeof DataType[keyof typeof DataType]

/**
 * Property form types
 */
export const PropertyForm = {
  NONE: 0x00,
  RANGE: 0x01,
  ENUM: 0x02,
} as const

export type PropertyForm = typeof PropertyForm[keyof typeof PropertyForm]

/**
 * Property access types
 */
export const PropertyAccess = {
  READ_ONLY: 0x00,
  READ_WRITE: 0x01,
} as const

export type PropertyAccess = typeof PropertyAccess[keyof typeof PropertyAccess]