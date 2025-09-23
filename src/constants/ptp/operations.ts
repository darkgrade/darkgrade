/**
 * PTP Operations with type validation
 */

import { DataType, OperationDefinition } from '@constants/types'

/**
 * PTP Operations with type validation
 */
export const PTPOperations = {
  // Session operations
  GET_DEVICE_INFO: {
    code: 0x1001,
    description: 'Get device information including manufacturer, model, and supported operations',
    dataIn: true,
    dataDescription: 'DeviceInfo dataset'
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
  
  // Storage operations
  GET_STORAGE_IDS: {
    code: 0x1004,
    description: 'Get list of storage IDs',
    dataIn: true,
    dataDescription: 'Array of storage IDs'
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
    ],
    dataIn: true,
    dataDescription: 'StorageInfo dataset'
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
    dataIn: true,
    dataDescription: 'Array of object handles'
  },
  
  // Object operations
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
    dataIn: true,
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
    dataIn: true,
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
    dataIn: true,
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
  SEND_OBJECT_INFO: {
    code: 0x100C,
    description: 'Send object information',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Target storage'
      },
      {
        name: 'parentObjectHandle',
        type: DataType.UINT32,
        description: 'Parent folder'
      }
    ],
    dataOut: true,
    dataDescription: 'ObjectInfo to send'
  },
  SEND_OBJECT: {
    code: 0x100D,
    description: 'Send object data',
    dataOut: true,
    dataDescription: 'Object data to send'
  },
  
  // Capture operations
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
  FORMAT_STORE: {
    code: 0x100F,
    description: 'Format storage device',
    parameters: [
      {
        name: 'storageId',
        type: DataType.UINT32,
        description: 'Storage to format'
      },
      {
        name: 'filesystemFormat',
        type: DataType.UINT16,
        description: 'Filesystem format'
      }
    ]
  },
  RESET_DEVICE: {
    code: 0x1010,
    description: 'Reset device to default state'
  },
  SELF_TEST: {
    code: 0x1011,
    description: 'Run device self test',
    parameters: [
      {
        name: 'testType',
        type: DataType.UINT16,
        description: 'Type of self test'
      }
    ]
  },
  
  // Property operations
  SET_OBJECT_PROTECTION: {
    code: 0x1012,
    description: 'Set object protection status',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object to protect'
      },
      {
        name: 'protectionStatus',
        type: DataType.UINT16,
        description: 'Protection status'
      }
    ]
  },
  POWER_DOWN: {
    code: 0x1013,
    description: 'Power down device'
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
    dataIn: true,
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
    dataIn: true,
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
    dataOut: true,
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
  TERMINATE_OPEN_CAPTURE: {
    code: 0x1018,
    description: 'Terminate an open capture operation',
    parameters: [
      {
        name: 'transactionId',
        type: DataType.UINT32,
        description: 'Transaction ID of capture'
      }
    ]
  },
  
  // Object manipulation
  MOVE_OBJECT: {
    code: 0x1019,
    description: 'Move object to new location',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object to move'
      },
      {
        name: 'targetStorageId',
        type: DataType.UINT32,
        description: 'Target storage'
      },
      {
        name: 'targetObjectHandle',
        type: DataType.UINT32,
        description: 'Target parent folder'
      }
    ]
  },
  COPY_OBJECT: {
    code: 0x101A,
    description: 'Copy object to new location',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object to copy'
      },
      {
        name: 'targetStorageId',
        type: DataType.UINT32,
        description: 'Target storage'
      },
      {
        name: 'targetObjectHandle',
        type: DataType.UINT32,
        description: 'Target parent folder'
      }
    ]
  },
  GET_PARTIAL_OBJECT: {
    code: 0x101B,
    description: 'Get partial object data',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Object handle'
      },
      {
        name: 'offset',
        type: DataType.UINT32,
        description: 'Byte offset'
      },
      {
        name: 'maxBytes',
        type: DataType.UINT32,
        description: 'Maximum bytes to return'
      }
    ],
    dataIn: true,
    dataDescription: 'Partial object data'
  },
  INITIATE_OPEN_CAPTURE: {
    code: 0x101C,
    description: 'Initiate open-ended capture',
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
  }
} as const satisfies OperationDefinition

export type PTPOperationDefinitions = typeof PTPOperations