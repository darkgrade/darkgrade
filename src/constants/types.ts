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
    INT128: 0x000a,
    ARRAY_UINT8: 0x4001,
    ARRAY_INT8: 0x4002,
    ARRAY_UINT16: 0x4003,
    ARRAY_INT16: 0x4004,
    ARRAY_UINT32: 0x4005,
    ARRAY_INT32: 0x4006,
    ARRAY_UINT64: 0x4007,
    ARRAY_INT64: 0x4008,
    STRING: 0xffff,
} as const

export type DataTypeValue = (typeof DataType)[keyof typeof DataType]

type DataTypeMap = {
    [DataType.UINT8]: number
    [DataType.INT8]: number
    [DataType.UINT16]: number
    [DataType.INT16]: number
    [DataType.UINT32]: number
    [DataType.INT32]: number
    [DataType.UINT64]: number
    [DataType.INT64]: number
    [DataType.UINT128]: number
    [DataType.INT128]: number
    [DataType.ARRAY_UINT8]: number[]
    [DataType.ARRAY_INT8]: number[]
    [DataType.ARRAY_UINT16]: number[]
    [DataType.ARRAY_INT16]: number[]
    [DataType.ARRAY_UINT32]: number[]
    [DataType.ARRAY_INT32]: number[]
    [DataType.ARRAY_UINT64]: number[]
    [DataType.ARRAY_INT64]: number[]
    [DataType.STRING]: string
}

/**
 * Property form types
 */
export const PropertyForm = {
    NONE: 0x00,
    RANGE: 0x01,
    ENUM: 0x02,
} as const

export type PropertyFormValue = (typeof PropertyForm)[keyof typeof PropertyForm]

/**
 * Property access types
 */
export const PropertyAccess = {
    READ_ONLY: 0x00,
    READ_WRITE: 0x01,
} as const

export type PropertyAccessValue = (typeof PropertyAccess)[keyof typeof PropertyAccess]

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
// Core Types - Separated Definition and Runtime
// ============================================================================

/**
 * Possible value for a parameter
 */
export interface PossibleValue<T> {
    name: string
    description: string
    value: T
}

export type Parameter = {
    [K in keyof DataTypeMap]: {
        name: string
        type: K
        description: string
        possibleValues?: PossibleValue<DataTypeMap[K]>[]
        // only present at runtime, not necessary for parameter definitions
        value?: DataTypeMap[K]
    }
}[keyof DataTypeMap]

export interface Operation {
    code: HexCode
    name?: string
    description?: string
    parameters?: Parameter[]
    expectsData?: boolean
    respondsWithData?: boolean
    dataDescription?: string
    maxDataLength?: number
    // only present at runtime, not necessary for operation definitions
    data?: Uint8Array
}

/**
 * Response - used in constants and runtime
 */
export interface Response {
    code: HexCode
    // Constant fields
    name?: string
    description?: string
    // Runtime fields
    sessionId?: number
    transactionId?: number
    parameters?: HexCode[]
    data?: Uint8Array
    raw?: Uint8Array
    type?: MessageType
}

/**
 * Event - used in constants and runtime
 */
export interface Event {
    code: HexCode
    // Constant fields
    description?: string
    parameters?:
        | Array<{
              name: string
              type: DataTypeValue
              description: string
          }>
        | number[] // Can be parameter definitions OR runtime values
    // Runtime fields
    sessionId?: number
    transactionId?: number
}

/**
 * Property definition
 */
export interface Property<T> {
    name: string
    code: HexCode
    type: DataTypeValue
    unit?: string
    description: string
    writable?: boolean
    descriptor?: PropertyDescriptor<any>
    enum?: Record<string, HexCode>
    encode?: (value: T) => Uint8Array
    decode?: (value: Uint8Array) => any
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

/**
 * Storage definition
 */
export interface Storage {
    name: string
    code: HexCode
    description: string
}

/**
 * Format definition
 */
export interface Format {
    name: string
    code: HexCode
    type: 'A' | 'I' | any
    description: string
    fileExtension?: string
}

// ============================================================================
// Collection Types (for constant objects)
// ============================================================================

export type OperationDefinitions = Record<string, Operation>
export type ResponseDefinition = Record<string, Response>
export type EventDefinition = Record<string, Event>
export type PropertyDefinition<T> = Record<string, Property<T>>
export type StorageDefinition = Record<string, Storage>
export type FormatDefinition = Record<string, Format>
