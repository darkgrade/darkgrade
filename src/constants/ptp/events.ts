/**
 * PTP Events with type validation
 * V7 Architecture - Type-safe with validation
 */

import { DataType } from '@constants/types'
import type { EventDefinitionShape } from '@constants/validation-types'

/**
 * PTP Events with type validation
 */
export const PTPEvents = {
  UNDEFINED: {
    code: 0x4000,
    description: 'Undefined event'
  },
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
  }
} as const satisfies EventDefinitionShape

export type PTPEventDefinitions = typeof PTPEvents