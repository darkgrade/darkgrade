/**
 * PTP Response codes with type validation
 */

import { ResponseDefinition } from '@constants/types'

/**
 * PTP Response codes with type validation
 */
export const PTPResponses = {
  UNDEFINED: {
    name: 'UNDEFINED',
    code: 0x2000,
    description: 'Undefined response',
    recoverable: false
  },
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
  INVALID_OBJECT_FORMAT_CODE: {
    name: 'INVALID_OBJECT_FORMAT_CODE',
    code: 0x200B,
    description: 'Object format code is invalid',
    recoverable: false
  },
  STORAGE_FULL: {
    name: 'STORAGE_FULL',
    code: 0x200C,
    description: 'Storage device is full',
    recoverable: true
  },
  OBJECT_WRITE_PROTECTED: {
    name: 'OBJECT_WRITE_PROTECTED',
    code: 0x200D,
    description: 'Object is write protected',
    recoverable: false
  },
  STORE_READ_ONLY: {
    name: 'STORE_READ_ONLY',
    code: 0x200E,
    description: 'Storage is read only',
    recoverable: false
  },
  ACCESS_DENIED: {
    name: 'ACCESS_DENIED',
    code: 0x200F,
    description: 'Access denied to resource',
    recoverable: false
  },
  NO_THUMBNAIL_PRESENT: {
    name: 'NO_THUMBNAIL_PRESENT',
    code: 0x2010,
    description: 'No thumbnail available for object',
    recoverable: true
  },
  SELF_TEST_FAILED: {
    name: 'SELF_TEST_FAILED',
    code: 0x2011,
    description: 'Device self test failed',
    recoverable: false
  },
  PARTIAL_DELETION: {
    name: 'PARTIAL_DELETION',
    code: 0x2012,
    description: 'Only partial deletion was successful',
    recoverable: true
  },
  STORE_NOT_AVAILABLE: {
    name: 'STORE_NOT_AVAILABLE',
    code: 0x2013,
    description: 'Storage is not available',
    recoverable: true
  },
  SPECIFICATION_BY_FORMAT_UNSUPPORTED: {
    name: 'SPECIFICATION_BY_FORMAT_UNSUPPORTED',
    code: 0x2014,
    description: 'Specification by format is unsupported',
    recoverable: false
  },
  NO_VALID_OBJECT_INFO: {
    name: 'NO_VALID_OBJECT_INFO',
    code: 0x2015,
    description: 'No valid object information available',
    recoverable: false
  },
  INVALID_CODE_FORMAT: {
    name: 'INVALID_CODE_FORMAT',
    code: 0x2016,
    description: 'Invalid code format',
    recoverable: false
  },
  UNKNOWN_VENDOR_CODE: {
    name: 'UNKNOWN_VENDOR_CODE',
    code: 0x2017,
    description: 'Unknown vendor specific code',
    recoverable: false
  },
  CAPTURE_ALREADY_TERMINATED: {
    name: 'CAPTURE_ALREADY_TERMINATED',
    code: 0x2018,
    description: 'Capture has already been terminated',
    recoverable: true
  },
  DEVICE_BUSY: {
    name: 'DEVICE_BUSY',
    code: 0x2019,
    description: 'Device is busy',
    recoverable: true
  },
  INVALID_PARENT_OBJECT: {
    name: 'INVALID_PARENT_OBJECT',
    code: 0x201A,
    description: 'Parent object is invalid',
    recoverable: false
  },
  INVALID_DEVICE_PROP_FORMAT: {
    name: 'INVALID_DEVICE_PROP_FORMAT',
    code: 0x201B,
    description: 'Invalid device property format',
    recoverable: false
  },
  INVALID_DEVICE_PROP_VALUE: {
    name: 'INVALID_DEVICE_PROP_VALUE',
    code: 0x201C,
    description: 'Invalid device property value',
    recoverable: false
  },
  INVALID_PARAMETER: {
    name: 'INVALID_PARAMETER',
    code: 0x201D,
    description: 'Invalid parameter provided',
    recoverable: false
  },
  SESSION_ALREADY_OPEN: {
    name: 'SESSION_ALREADY_OPEN',
    code: 0x201E,
    description: 'Session is already open',
    recoverable: true
  },
  TRANSACTION_CANCELLED: {
    name: 'TRANSACTION_CANCELLED',
    code: 0x201F,
    description: 'Transaction was cancelled',
    recoverable: true
  },
  SPECIFICATION_OF_DESTINATION_UNSUPPORTED: {
    name: 'SPECIFICATION_OF_DESTINATION_UNSUPPORTED',
    code: 0x2020,
    description: 'Specification of destination unsupported',
    recoverable: false
  }
} as const satisfies ResponseDefinition

export type PTPResponseDefinitions = typeof PTPResponses