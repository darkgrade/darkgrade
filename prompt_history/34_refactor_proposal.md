# PTP Constants Refactoring Proposal V7 (Type-Safe with Validation)

## Important Note

**This proposal defines the STRUCTURE of the new code architecture only.** All actual hex codes, encoders, decoders, and implementation details should be taken from the existing codebase. The examples shown here are illustrative of the pattern, not the actual values to use.

## Overview

A type-safe approach using TypeScript's `satisfies` operator for validation while maintaining type inference through `as const`. This ensures our implementations match expected shapes while keeping the benefits of literal types.

## Core Philosophy

1. **Type Validation**: Use `satisfies` to validate structure
2. **Type Inference**: Use `as const` for literal type inference  
3. **Best of Both Worlds**: Compile-time validation + full intellisense
4. **Self-Documenting**: All constants include descriptions
5. **Minimal Boilerplate**: Single definition with validation

## Architecture

### 1. Core Types

```typescript
// src/constants/types.ts

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
```

### 2. Validation Types

```typescript
// src/constants/validation-types.ts

import type { HexCode, DataType, PropertyForm } from './types'

/**
 * Response definition shape for validation
 */
export type ResponseDefinitionShape = Record<string, {
  name: string
  code: HexCode
  description: string
  recoverable?: boolean
}>

/**
 * Operation definition shape for validation
 */
export type OperationDefinitionShape = Record<string, {
  code: HexCode
  description: string
  parameters?: Array<{
    name: string
    type: DataType
    description: string
  }>
  hasDataPhase?: boolean
  dataDescription?: string
}>

/**
 * Event definition shape for validation
 */
export type EventDefinitionShape = Record<string, {
  code: HexCode
  description: string
  parameters?: Array<{
    name: string
    type: DataType
    description: string
  }>
}>

/**
 * Format definition shape for validation
 */
export type FormatDefinitionShape = Record<string, {
  name: string
  code: HexCode
  description: string
  fileExtension?: string
  mimeType?: string
}>

/**
 * Storage type definition shape for validation
 */
export type StorageTypeDefinitionShape = Record<string, {
  name: string
  code: HexCode
  description: string
}>

/**
 * Control definition shape for validation
 */
export type ControlDefinitionShape = Record<string, {
  property: HexCode
  value: HexCode
  description: string
  holdable?: boolean
}>
```

### 3. Property Type System with Validation

```typescript
// src/constants/property-types.ts

import type { HexCode, DataType, PropertyForm } from './types'

/**
 * Property descriptor for allowed values
 */
export interface PropertyDescriptor<T> {
  current?: T
  default?: T
  form: PropertyForm
  min?: T
  max?: T
  step?: T
  allowedValues?: T[]
}

/**
 * Base property definition
 */
export interface BaseProperty<TName extends string = string, TValue = any> {
  name: TName
  code: HexCode
  type: DataType
  unit?: string
  description: string
  writable?: boolean
  descriptor?: PropertyDescriptor<TValue>
}

/**
 * Property with enum values
 */
export interface EnumProperty<TName extends string = string, TEnum extends string = string> 
  extends BaseProperty<TName, TEnum> {
  enum: Record<TEnum, HexCode>
}

/**
 * Property with custom encoding
 */
export interface CustomProperty<TName extends string = string, TInput = any, TOutput = TInput> 
  extends BaseProperty<TName, TInput> {
  encode: (value: TInput) => HexCode | Uint8Array
  decode: (value: HexCode | Uint8Array) => TOutput
}

/**
 * Numeric property
 */
export interface NumericProperty<TName extends string = string> 
  extends BaseProperty<TName, number> {}

/**
 * String property
 */
export interface StringProperty<TName extends string = string> 
  extends BaseProperty<TName, string> {}

/**
 * Union of all property types
 */
export type Property = 
  | EnumProperty
  | CustomProperty
  | NumericProperty
  | StringProperty

/**
 * Property definition shape for validation
 */
export type PropertyDefinitionShape = Record<string, Property>
```

### 4. PTP Properties with Validation

```typescript
// src/constants/ptp/properties.ts

import { DataType, PropertyForm } from '../types'
import type { PropertyDefinitionShape } from '../property-types'

/**
 * PTP standard property definitions with type validation
 */
export const PTPProperties = {
  BATTERY_LEVEL: {
    name: 'BATTERY_LEVEL',
    code: 0x5001,
    type: DataType.UINT8,
    unit: '%',
    description: 'Current battery charge level as a percentage',
    writable: false,
    descriptor: {
      form: PropertyForm.RANGE,
      min: 0,
      max: 100,
      step: 1
    }
  },
  
  FUNCTIONAL_MODE: {
    name: 'FUNCTIONAL_MODE',
    code: 0x5002,
    type: DataType.UINT16,
    description: 'Current functional mode of the device',
    writable: true,
    enum: {
      'STANDARD': 0x0000,
      'SLEEP': 0x0001,
    }
  },
  
  WHITE_BALANCE: {
    name: 'WHITE_BALANCE',
    code: 0x5005,
    type: DataType.UINT16,
    description: 'White balance setting for color temperature adjustment',
    writable: true,
    enum: {
      'AUTO': 0x0002,
      'MANUAL': 0x0001,
      'DAYLIGHT': 0x0004,
      'FLUORESCENT': 0x0005,
      'TUNGSTEN': 0x0006,
      'FLASH': 0x0007,
      'CLOUDY': 0x8010,
      'SHADE': 0x8011,
    }
  },
  
  F_NUMBER: {
    name: 'F_NUMBER',
    code: 0x5007,
    type: DataType.UINT16,
    unit: 'f-stop',
    description: 'Aperture f-number for exposure control',
    writable: true,
    encode: (value: string | number) => {
      const num = typeof value === 'string' 
        ? parseFloat(value.replace('f/', ''))
        : value
      return Math.round(num * 100)
    },
    decode: (value: HexCode | Uint8Array) => {
      const num = typeof value === 'number' ? value : 0
      return `f/${(num / 100).toFixed(1)}`
    }
  },
  
  FOCUS_MODE: {
    name: 'FOCUS_MODE',
    code: 0x500A,
    type: DataType.UINT16,
    description: 'Focus mode for autofocus behavior',
    writable: true,
    enum: {
      'MANUAL': 0x0001,
      'AUTO_SINGLE': 0x0002,
      'AUTO_CONTINUOUS': 0x0003,
    }
  },
  
  EXPOSURE_TIME: {
    name: 'EXPOSURE_TIME',
    code: 0x500D,
    type: DataType.UINT32,
    unit: 'microseconds',
    description: 'Shutter speed/exposure time in microseconds',
    writable: true
  },
  
  EXPOSURE_INDEX: {
    name: 'EXPOSURE_INDEX',
    code: 0x500F,
    type: DataType.UINT16,
    unit: 'ISO',
    description: 'ISO sensitivity value',
    writable: true
  },
  
  // ... continue with all other properties
} as const satisfies PropertyDefinitionShape

export type PTPPropertyDefinitions = typeof PTPProperties
```

### 5. PTP Response Codes with Validation

```typescript
// src/constants/ptp/responses.ts

import type { ResponseDefinitionShape } from '../validation-types'

/**
 * PTP Response codes with type validation
 */
export const PTPResponses = {
  OK: {
    name: 'OK',
    code: 0x2001,
    description: 'Operation completed successfully',
    recoverable: true
  },
  GENERAL_ERROR: {
    name: 'GENERAL_ERROR',
    code: 0x2002,
    description: 'General error occurred',
    recoverable: false
  },
  SESSION_NOT_OPEN: {
    name: 'SESSION_NOT_OPEN',
    code: 0x2003,
    description: 'Session is not open',
    recoverable: true
  },
  INVALID_TRANSACTION_ID: {
    name: 'INVALID_TRANSACTION_ID',
    code: 0x2004,
    description: 'Transaction ID is invalid',
    recoverable: true
  },
  OPERATION_NOT_SUPPORTED: {
    name: 'OPERATION_NOT_SUPPORTED',
    code: 0x2005,
    description: 'Operation is not supported',
    recoverable: false
  },
  PARAMETER_NOT_SUPPORTED: {
    name: 'PARAMETER_NOT_SUPPORTED',
    code: 0x2006,
    description: 'Parameter is not supported',
    recoverable: false
  },
  INCOMPLETE_TRANSFER: {
    name: 'INCOMPLETE_TRANSFER',
    code: 0x2007,
    description: 'Data transfer incomplete',
    recoverable: true
  },
  INVALID_STORAGE_ID: {
    name: 'INVALID_STORAGE_ID',
    code: 0x2008,
    description: 'Storage ID is invalid',
    recoverable: false
  },
  INVALID_OBJECT_HANDLE: {
    name: 'INVALID_OBJECT_HANDLE',
    code: 0x2009,
    description: 'Object handle is invalid',
    recoverable: false
  },
  DEVICE_PROP_NOT_SUPPORTED: {
    name: 'DEVICE_PROP_NOT_SUPPORTED',
    code: 0x200A,
    description: 'Device property not supported',
    recoverable: false
  },
  DEVICE_BUSY: {
    name: 'DEVICE_BUSY',
    code: 0x2019,
    description: 'Device is busy',
    recoverable: true
  },
  // ... all other response codes
} as const satisfies ResponseDefinitionShape

export type PTPResponseDefinitions = typeof PTPResponses
```

### 6. PTP Operations with Validation

```typescript
// src/constants/ptp/operations.ts

import { DataType } from '../types'
import type { OperationDefinitionShape } from '../validation-types'

/**
 * PTP Operations with type validation
 */
export const PTPOperations = {
  GET_DEVICE_INFO: {
    code: 0x1001,
    description: 'Get device information including manufacturer, model, and supported operations'
  },
  OPEN_SESSION: {
    code: 0x1002,
    description: 'Open a new session with the device',
    parameters: [
      {
        name: 'sessionId',
        type: DataType.UINT32,
        description: 'Unique session identifier'
      }
    ]
  },
  CLOSE_SESSION: {
    code: 0x1003,
    description: 'Close the current session'
  },
  GET_STORAGE_IDS: {
    code: 0x1004,
    description: 'Get list of storage IDs'
  },
  GET_STORAGE_INFO: {
    code: 0x1005,
    description: 'Get information about a specific storage',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Storage identifier to query'
      }
    ]
  },
  GET_NUM_OBJECTS: {
    code: 0x1006,
    description: 'Get number of objects',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Storage ID (0xFFFFFFFF for all)'
      },
      {
        name: 'objectFormat',
        type: DataType.UINT16,
        description: 'Object format (0x0000 for all)'
      },
      {
        name: 'associationHandle',
        type: DataType.UINT32,
        description: 'Parent folder (0x00000000 for root)'
      }
    ]
  },
  GET_OBJECT_HANDLES: {
    code: 0x1007,
    description: 'Get object handles',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Storage ID'
      },
      {
        name: 'objectFormat',
        type: DataType.UINT16,
        description: 'Object format filter'
      },
      {
        name: 'associationHandle',
        type: DataType.UINT32,
        description: 'Parent folder handle'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Array of object handles'
  },
  GET_OBJECT_INFO: {
    code: 0x1008,
    description: 'Get object information',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object handle'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'ObjectInfo dataset'
  },
  GET_OBJECT: {
    code: 0x1009,
    description: 'Retrieve an object from the device',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Handle of the object to retrieve'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Object data in format specified by ObjectInfo'
  },
  GET_THUMB: {
    code: 0x100A,
    description: 'Get thumbnail',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object handle'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Thumbnail image data'
  },
  DELETE_OBJECT: {
    code: 0x100B,
    description: 'Delete an object',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object to delete'
      },
      {
        name: 'objectFormat',
        type: DataType.UINT16,
        description: 'Format code (unused)'
      }
    ]
  },
  INITIATE_CAPTURE: {
    code: 0x100E,
    description: 'Initiate image capture',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Target storage'
      },
      {
        name: 'objectFormat',
        type: DataType.UINT16,
        description: 'Capture format'
      }
    ]
  },
  GET_DEVICE_PROP_DESC: {
    code: 0x1014,
    description: 'Get device property descriptor',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property code to query'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Property descriptor data'
  },
  GET_DEVICE_PROP_VALUE: {
    code: 0x1015,
    description: 'Get current value of a device property',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property code to get'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Current property value'
  },
  SET_DEVICE_PROP_VALUE: {
    code: 0x1016,
    description: 'Set the value of a device property',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property code to set'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'New property value'
  },
  RESET_DEVICE_PROP_VALUE: {
    code: 0x1017,
    description: 'Reset property to default value',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property to reset'
      }
    ]
  },
  // ... all other operations
} as const satisfies OperationDefinitionShape

export type PTPOperationDefinitions = typeof PTPOperations
```

### 7. PTP Events with Validation

```typescript
// src/constants/ptp/events.ts

import { DataType } from '../types'
import type { EventDefinitionShape } from '../validation-types'

/**
 * PTP Events with type validation
 */
export const PTPEvents = {
  CANCEL_TRANSACTION: {
    code: 0x4001,
    description: 'Transaction has been cancelled',
    parameters: [
      {
        name: 'transactionId',
        type: DataType.UINT32,
        description: 'ID of the cancelled transaction'
      }
    ]
  },
  OBJECT_ADDED: {
    code: 0x4002,
    description: 'A new object has been created on the device',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Handle of the newly added object'
      }
    ]
  },
  OBJECT_REMOVED: {
    code: 0x4003,
    description: 'An object has been removed',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Handle of the removed object'
      }
    ]
  },
  STORE_ADDED: {
    code: 0x4004,
    description: 'A new storage has been added',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'ID of the new storage'
      }
    ]
  },
  STORE_REMOVED: {
    code: 0x4005,
    description: 'A storage has been removed',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'ID of the removed storage'
      }
    ]
  },
  DEVICE_PROP_CHANGED: {
    code: 0x4006,
    description: 'A device property value has changed',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property code that changed'
      }
    ]
  },
  OBJECT_INFO_CHANGED: {
    code: 0x4007,
    description: 'Object information has changed',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object that changed'
      }
    ]
  },
  DEVICE_INFO_CHANGED: {
    code: 0x4008,
    description: 'Device information has changed'
  },
  REQUEST_OBJECT_TRANSFER: {
    code: 0x4009,
    description: 'Device requests object transfer',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object to transfer'
      }
    ]
  },
  STORE_FULL: {
    code: 0x400A,
    description: 'Storage is full',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Full storage ID'
      }
    ]
  },
  DEVICE_RESET: {
    code: 0x400B,
    description: 'Device has been reset'
  },
  STORAGE_INFO_CHANGED: {
    code: 0x400C,
    description: 'Storage information has changed',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Storage that changed'
      }
    ]
  },
  CAPTURE_COMPLETE: {
    code: 0x400D,
    description: 'Image capture has completed successfully'
  },
  UNREPORTED_STATUS: {
    code: 0x400E,
    description: 'Device has unreported status changes'
  },
  // ... all other events
} as const satisfies EventDefinitionShape

export type PTPEventDefinitions = typeof PTPEvents
```

### 8. PTP Object Formats with Validation

```typescript
// src/constants/ptp/formats.ts

import type { FormatDefinitionShape } from '../validation-types'

/**
 * PTP Object Formats with type validation
 */
export const PTPFormats = {
  UNDEFINED: {
    name: 'UNDEFINED',
    code: 0x3000,
    description: 'Undefined object format'
  },
  ASSOCIATION: {
    name: 'ASSOCIATION',
    code: 0x3001,
    description: 'Association (folder)',
  },
  SCRIPT: {
    name: 'SCRIPT',
    code: 0x3002,
    description: 'Script file'
  },
  EXECUTABLE: {
    name: 'EXECUTABLE',
    code: 0x3003,
    description: 'Executable file'
  },
  TEXT: {
    name: 'TEXT',
    code: 0x3004,
    description: 'Text file',
    fileExtension: '.txt',
    mimeType: 'text/plain'
  },
  HTML: {
    name: 'HTML',
    code: 0x3005,
    description: 'HTML file',
    fileExtension: '.html',
    mimeType: 'text/html'
  },
  DPOF: {
    name: 'DPOF',
    code: 0x3006,
    description: 'Digital Print Order Format'
  },
  AIFF: {
    name: 'AIFF',
    code: 0x3007,
    description: 'AIFF audio',
    fileExtension: '.aiff',
    mimeType: 'audio/aiff'
  },
  WAV: {
    name: 'WAV',
    code: 0x3008,
    description: 'WAV audio',
    fileExtension: '.wav',
    mimeType: 'audio/wav'
  },
  MP3: {
    name: 'MP3',
    code: 0x3009,
    description: 'MP3 audio',
    fileExtension: '.mp3',
    mimeType: 'audio/mp3'
  },
  AVI: {
    name: 'AVI',
    code: 0x300A,
    description: 'AVI video',
    fileExtension: '.avi',
    mimeType: 'video/avi'
  },
  MPEG: {
    name: 'MPEG',
    code: 0x300B,
    description: 'MPEG video',
    fileExtension: '.mpeg',
    mimeType: 'video/mpeg'
  },
  EXIF_JPEG: {
    name: 'EXIF_JPEG',
    code: 0x3801,
    description: 'EXIF/JPEG image',
    fileExtension: '.jpg',
    mimeType: 'image/jpeg'
  },
  TIFF_EP: {
    name: 'TIFF_EP',
    code: 0x3802,
    description: 'TIFF EP format',
    fileExtension: '.tiff',
    mimeType: 'image/tiff'
  },
  BMP: {
    name: 'BMP',
    code: 0x3804,
    description: 'Bitmap image',
    fileExtension: '.bmp',
    mimeType: 'image/bmp'
  },
  PNG: {
    name: 'PNG',
    code: 0x380B,
    description: 'PNG image',
    fileExtension: '.png',
    mimeType: 'image/png'
  },
  // ... all other formats
} as const satisfies FormatDefinitionShape

export type PTPFormatDefinitions = typeof PTPFormats
```

### 9. PTP Storage Types with Validation

```typescript
// src/constants/ptp/storage.ts

import type { StorageTypeDefinitionShape } from '../validation-types'

/**
 * PTP Storage Types with type validation
 */
export const PTPStorageTypes = {
  UNDEFINED: {
    name: 'UNDEFINED',
    code: 0x0000,
    description: 'Undefined storage type'
  },
  FIXED_ROM: {
    name: 'FIXED_ROM',
    code: 0x0001,
    description: 'Fixed ROM storage'
  },
  REMOVABLE_ROM: {
    name: 'REMOVABLE_ROM',
    code: 0x0002,
    description: 'Removable ROM storage (CD, DVD)'
  },
  FIXED_RAM: {
    name: 'FIXED_RAM',
    code: 0x0003,
    description: 'Fixed RAM storage (internal memory)'
  },
  REMOVABLE_RAM: {
    name: 'REMOVABLE_RAM',
    code: 0x0004,
    description: 'Removable RAM storage (memory card)'
  }
} as const satisfies StorageTypeDefinitionShape

export type PTPStorageTypeDefinitions = typeof PTPStorageTypes
```

### 10. Sony Vendor Extensions (No Validation Needed)

```typescript
// src/constants/vendors/sony/properties.ts

import { DataType, PropertyForm } from '../../types'
import { PTPProperties } from '../../ptp/properties'
import type { PropertyDefinitionShape } from '../../property-types'

/**
 * Sony property definitions - extending and overriding PTP
 * Vendor extensions don't need validation as they define their own shape
 */
export const SonyProperties = {
  ...PTPProperties, // Start with PTP standard
  
  // Override with Sony-specific implementation
  EXPOSURE_INDEX: {
    name: 'EXPOSURE_INDEX',
    code: 0x500F,
    type: DataType.UINT32, // Sony uses UINT32 instead of UINT16
    unit: 'ISO',
    description: 'ISO sensitivity with Sony-specific auto modes',
    writable: true,
    enum: {
      'AUTO': 0x00FFFFFF,
      'AUTO_MULTI_NR': 0x01FFFFFF,
      '50': 50,
      '100': 100,
      '200': 200,
      '400': 400,
      '800': 800,
      '1600': 1600,
      '3200': 3200,
      '6400': 6400,
      '12800': 12800,
      '25600': 25600,
    }
  },
  
  // Sony-specific properties
  SHUTTER_SPEED: {
    name: 'SHUTTER_SPEED',
    code: 0xD20D,
    type: DataType.UINT32,
    unit: 'seconds',
    description: 'Sony-specific shutter speed encoding with bulb mode support',
    writable: true,
    encode: (value: string) => {
      // Implementation from existing Sony codebase
      if (value === 'BULB') return 0x00000000
      if (value.startsWith('1/')) {
        const denom = parseInt(value.substring(2))
        return (0x0001 << 16) | denom
      }
      const seconds = parseFloat(value.replace('"', ''))
      return (Math.round(seconds * 10) << 16) | 0x000A
    },
    decode: (value: HexCode | Uint8Array) => {
      // Implementation from existing Sony codebase
      const num = typeof value === 'number' ? value : 0
      if (num === 0x00000000) return 'BULB'
      if (num === 0xFFFFFFFF) return 'N/A'
      const numerator = (num >> 16) & 0xFFFF
      const denominator = num & 0xFFFF
      if (denominator === 0x000A) return `${numerator / 10}"`
      if (numerator === 0x0001) return `1/${denominator}`
      return `${numerator}/${denominator}`
    }
  },
  
  // ... rest of Sony properties
} as const satisfies PropertyDefinitionShape // Optional validation for vendors

export type SonyPropertyDefinitions = typeof SonyProperties
```

### 11. Sony Operations (No Validation Needed)

```typescript
// src/constants/vendors/sony/operations.ts

import { PTPOperations } from '../../ptp/operations'
import { DataType } from '../../types'

/**
 * Sony operations - extending PTP
 * Vendor extensions define their own shape
 */
export const SonyOperations = {
  ...PTPOperations,
  
  SDIO_CONNECT: {
    code: 0x9201,
    description: 'Sony-specific SDIO connection handshake',
    parameters: [
      {
        name: 'phase',
        type: DataType.UINT32,
        description: 'Connection phase (1, 2, or 3)'
      },
      {
        name: 'version',
        type: DataType.UINT32,
        description: 'Protocol version'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Connection handshake data'
  },
  
  GET_ALL_DEVICE_PROP_DATA: {
    code: 0x9209,
    description: 'Get all device properties in a single call'
  },
  
  CONTROL_DEVICE_PROPERTY: {
    code: 0x9207,
    description: 'Control device hardware buttons and switches',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Control property code'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Control value'
  }
} as const

export type SonyOperationDefinitions = typeof SonyOperations
```

### 12. Sony Events (No Validation Needed)

```typescript
// src/constants/vendors/sony/events.ts

import { PTPEvents } from '../../ptp/events'
import { DataType } from '../../types'

/**
 * Sony events - extending PTP
 */
export const SonyEvents = {
  ...PTPEvents,
  
  PROPERTY_CHANGED: {
    code: 0xC201,
    description: 'Sony extended property change notification',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property that changed'
      }
    ]
  },
  
  OBJECT_ADDED_IN_SDRAM: {
    code: 0xC203,
    description: 'New object added to camera SDRAM',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Handle of new object'
      }
    ]
  },
  
  CAPTURE_STATUS_CHANGED: {
    code: 0xC204,
    description: 'Capture status has changed',
    parameters: [
      {
        name: 'status',
        type: DataType.UINT16,
        description: 'New capture status'
      }
    ]
  }
} as const

export type SonyEventDefinitions = typeof SonyEvents
```

### 13. Sony Controls with Validation

```typescript
// src/constants/vendors/sony/controls.ts

import type { ControlDefinitionShape } from '../../validation-types'

/**
 * Sony hardware controls with type validation
 */
export const SonyControls = {
  SHUTTER_HALF_PRESS: {
    property: 0xD2C1,
    value: 0x0002,
    description: 'Half-press shutter button (focus)',
    holdable: true
  },
  SHUTTER_FULL_PRESS: {
    property: 0xD2C1,
    value: 0x0001,
    description: 'Full-press shutter button (capture)',
    holdable: false
  },
  SHUTTER_RELEASE: {
    property: 0xD2C1,
    value: 0x0000,
    description: 'Release shutter button'
  },
  FOCUS_HALF_PRESS: {
    property: 0xD2C2,
    value: 0x0002,
    description: 'Start autofocus',
    holdable: true
  },
  FOCUS_FULL_PRESS: {
    property: 0xD2C2,
    value: 0x0001,
    description: 'Lock focus',
    holdable: false
  },
  FOCUS_RELEASE: {
    property: 0xD2C2,
    value: 0x0000,
    description: 'Release focus button'
  },
  ZOOM_IN_START: {
    property: 0xD2D2,
    value: 0x0001,
    description: 'Start zooming in'
  },
  ZOOM_IN_STOP: {
    property: 0xD2D2,
    value: 0x0000,
    description: 'Stop zooming in'
  },
  ZOOM_OUT_START: {
    property: 0xD2D3,
    value: 0x0001,
    description: 'Start zooming out'
  },
  ZOOM_OUT_STOP: {
    property: 0xD2D3,
    value: 0x0000,
    description: 'Stop zooming out'
  },
  LIVE_VIEW_ENABLE: {
    property: 0xD313,
    value: 0x0002,
    description: 'Enable live view mode'
  },
  LIVE_VIEW_DISABLE: {
    property: 0xD313,
    value: 0x0001,
    description: 'Disable live view mode'
  }
} as const satisfies ControlDefinitionShape

export type SonyControlDefinitions = typeof SonyControls
```

### 14. Sony Responses (No Validation Needed)

```typescript
// src/constants/vendors/sony/responses.ts

import { PTPResponses } from '../../ptp/responses'

/**
 * Sony response codes - extending PTP
 */
export const SonyResponses = {
  ...PTPResponses,
  
  ALREADY_IN_LIVE_VIEW: {
    name: 'ALREADY_IN_LIVE_VIEW',
    code: 0xA001,
    description: 'Camera is already in live view mode',
    recoverable: true
  },
  
  NOT_IN_LIVE_VIEW: {
    name: 'NOT_IN_LIVE_VIEW',
    code: 0xA002,
    description: 'Camera is not in live view mode',
    recoverable: true
  },
  
  LENS_NOT_DETECTED: {
    name: 'LENS_NOT_DETECTED',
    code: 0xA003,
    description: 'No lens detected on camera',
    recoverable: false
  },
  
  CARD_NOT_FORMATTED: {
    name: 'CARD_NOT_FORMATTED',
    code: 0xA004,
    description: 'Memory card is not formatted',
    recoverable: true
  }
} as const

export type SonyResponseDefinitions = typeof SonyResponses
```

### 15. Runtime Mapping Utilities

```typescript
// src/constants/utilities.ts

import type { HexCode } from './types'

/**
 * Generic mapping utilities for all constant types
 */
export class ConstantMapper<T extends Record<string, { code: HexCode, [key: string]: any }>> {
  private codeToItem: Map<HexCode, T[keyof T]>
  private nameToItem: Map<string, T[keyof T]>
  
  constructor(private constants: T) {
    this.codeToItem = new Map()
    this.nameToItem = new Map()
    
    for (const [key, value] of Object.entries(constants)) {
      this.codeToItem.set(value.code, value as T[keyof T])
      this.nameToItem.set(key, value as T[keyof T])
    }
  }
  
  /**
   * Get constant by hex code
   */
  getByCode(code: HexCode): T[keyof T] | undefined {
    return this.codeToItem.get(code)
  }
  
  /**
   * Get constant by name
   */
  getByName(name: keyof T): T[keyof T] | undefined {
    return this.nameToItem.get(name as string)
  }
  
  /**
   * Get human-readable string for a code
   */
  toString(code: HexCode): string {
    const item = this.getByCode(code)
    if (item && 'name' in item) {
      return `${item.name} (0x${code.toString(16).padStart(4, '0')})`
    }
    return `Unknown (0x${code.toString(16).padStart(4, '0')})`
  }
  
  /**
   * Check if code is known
   */
  isKnown(code: HexCode): boolean {
    return this.codeToItem.has(code)
  }
  
  /**
   * Get all codes
   */
  getAllCodes(): HexCode[] {
    return Array.from(this.codeToItem.keys())
  }
  
  /**
   * Get all names
   */
  getAllNames(): (keyof T)[] {
    return Object.keys(this.constants) as (keyof T)[]
  }
}

// Pre-instantiated mappers for PTP constants
import { PTPOperations } from './ptp/operations'
import { PTPResponses } from './ptp/responses'
import { PTPEvents } from './ptp/events'
import { PTPFormats } from './ptp/formats'
import { PTPStorageTypes } from './ptp/storage'

export const OperationMapper = new ConstantMapper(PTPOperations)
export const ResponseMapper = new ConstantMapper(PTPResponses)
export const EventMapper = new ConstantMapper(PTPEvents)
export const FormatMapper = new ConstantMapper(PTPFormats)
export const StorageMapper = new ConstantMapper(PTPStorageTypes)

// Property mapper with special handling
import type { Property } from './property-types'

export class PropertyMapper<T extends Record<string, Property>> {
  constructor(private properties: T) {}
  
  getByCode(code: HexCode): Property | undefined {
    for (const prop of Object.values(this.properties)) {
      if (prop.code === code) return prop
    }
    return undefined
  }
  
  getByName(name: keyof T): Property | undefined {
    return this.properties[name]
  }
  
  toString(code: HexCode): string {
    const prop = this.getByCode(code)
    if (prop) {
      return `${prop.name} (0x${code.toString(16).padStart(4, '0')}): ${prop.description}`
    }
    return `Unknown Property (0x${code.toString(16).padStart(4, '0')})`
  }
}
```

### 16. Usage Example

```typescript
// Usage with complete type safety and validation
const camera = new SonyCamera(protocol)

// ✅ Type-safe property setting
await camera.setProperty('ISO_SENSITIVITY', 'AUTO')
await camera.setProperty('SHUTTER_SPEED', '1/250')

// ❌ TypeScript catches these errors at compile time
// Both type inference AND validation ensure correctness
await camera.setProperty('INVALID_PROP', 'value') // Error: Not a property
await camera.setProperty('ISO_SENSITIVITY', 'INVALID') // Error: Invalid value

// If we had defined PTPProperties incorrectly:
// const PTPProperties = {
//   BATTERY_LEVEL: {
//     name: 'BATTERY_LEVEL',
//     // missing required 'code' field
//   }
// } as const satisfies PropertyDefinitionShape
// ^^^ TypeScript Error: Missing required property 'code'

// ✅ All the same benefits as before, plus validation
const iso = await camera.getProperty('ISO_SENSITIVITY')
const isoValues = camera.getPropertyValues('ISO_SENSITIVITY')
await camera.sendControl('SHUTTER_HALF_PRESS')
camera.onEvent('CAPTURE_COMPLETE', () => console.log('Done!'))
```

## Key Benefits of V7

1. **Type Validation**: `satisfies` ensures our definitions match expected shapes
2. **Type Inference**: `as const` provides literal types for maximum specificity
3. **Compile-Time Safety**: Errors caught during development, not runtime
4. **Best of Both Worlds**: Structure validation + literal type inference
5. **Selective Validation**: Core PTP definitions validated, vendor extensions flexible
6. **Zero Runtime Cost**: All validation happens at compile time
7. **Better IDE Experience**: Errors shown immediately while typing

## What Changed from V6

- **Added**: Validation type shapes (`ResponseDefinitionShape`, `OperationDefinitionShape`, etc.)
- **Added**: `satisfies` operator on all PTP core definitions
- **Kept**: `as const` for type inference
- **Optional**: Vendor extensions can choose to validate or not
- **Improved**: Compile-time catching of structural errors

## Validation Strategy

**Core PTP Constants**: Always validated with `satisfies`
```typescript
export const PTPResponses = { ... } as const satisfies ResponseDefinitionShape
```

**Vendor Extensions**: Optional validation (usually not needed)
```typescript
// Can validate if desired
export const SonyProperties = { ... } as const satisfies PropertyDefinitionShape

// Or skip validation for flexibility
export const SonyProperties = { ... } as const
```

This ensures the PTP spec implementation is always correct while allowing vendor flexibility.