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
  },
  OK: {
    name: 'OK',
    code: 0x2001,
    description: 'operation completed successfully',
  },
  GENERAL_ERROR: {
    name: 'GENERAL_ERROR',
    code: 0x2002,
    description: 'operation did not complete. This response is used when the cause of the error is unknown or there is no better failure ResponseCode to use',
  },
  SESSION_NOT_OPEN: {
    name: 'SESSION_NOT_OPEN',
    code: 0x2003,
    description: 'indicates that the session handle of the operation is not a currently open session',
  },
  INVALID_TRANSACTION_ID: {
    name: 'INVALID_TRANSACTION_ID',
    code: 0x2004,
    description: 'indicates that the TransactionID is zero or does not refer to a valid transaction',
  },
  OPERATION_NOT_SUPPORTED: {
    name: 'OPERATION_NOT_SUPPORTED',
    code: 0x2005,
    description: 'indicates that the indicated OperationCode appears to be a valid code, but the responder does not support the operation. This error should not normally occur, as the initiator should only invoke operations that the responder indicated were supported in its DeviceInfo data set',
  },
  PARAMETER_NOT_SUPPORTED: {
    name: 'PARAMETER_NOT_SUPPORTED',
    code: 0x2006,
    description: 'indicates that a non-zero parameter was specified in conjunction with the operation, and that that parameter is not used for that operation. This response is distinctly different from Invalid_ Parameter described in 11.3.29',
  },
  INCOMPLETE_TRANSFER: {
    name: 'INCOMPLETE_TRANSFER',
    code: 0x2007,
    description: 'indicates that the transfer did not complete. Any data transferred should be discarded. This response should not be used if the transaction was manually cancelled. See the response Transaction_ Cancelled, described in 11.3.31',
  },
  INVALID_STORAGE_ID: {
    name: 'INVALID_STORAGE_ID',
    code: 0x2008,
    description: 'indicates that a StorageID sent with an operation does not refer to an actual valid store that is present on the device. The list of valid StorageIDs should be re-requested, along with any appropriate StorageInfo data sets',
  },
  INVALID_OBJECT_HANDLE: {
    name: 'INVALID_OBJECT_HANDLE',
    code: 0x2009,
    description: 'indicates that an ObjectHandle does not refer to an actual object that is present on the device. The list of valid ObjectHandles should be re-requested, along with any appropriate ObjectInfo data sets',
  },
  DEVICE_PROP_NOT_SUPPORTED: {
    name: 'DEVICE_PROP_NOT_SUPPORTED',
    code: 0x200A,
    description: 'the indicated DevicePropCode appears to be a valid code, but that property is not supported by the device. This response should not normally occur, as the initiator should only attempt to manipulate properties that the responder indicated were supported in the DevicePropertiesSupported array in the DeviceInfo data set',
  },
  INVALID_OBJECT_FORMAT_CODE: {
    name: 'INVALID_OBJECT_FORMAT_CODE',
    code: 0x200B,
    description: 'indicates that the device does not support the particular ObjectFormatCode supplied in the given context',
  },
  STORE_FULL: {
    name: 'STORE_FULL',
    code: 0x200C,
    description: 'indicates to the store that the operation referred to is full',
  },
  OBJECT_WRITE_PROTECTED: {
    name: 'OBJECT_WRITE_PROTECTED',
    code: 0x200D,
    description: 'indicates to the object that the operation referred to is write-protected',
  },
  STORE_READ_ONLY: {
    name: 'STORE_READ_ONLY',
    code: 0x200E,
    description: 'indicates to the store that the operation referred to is read-only',
  },
  ACCESS_DENIED: {
    name: 'ACCESS_DENIED',
    code: 0x200F,
    description: 'indicates that access to the data referred to by the operation has been denied. The intent of this response is not to indicate that the device is busy, but that given that the current state of the device does not change, access will continue to be denied',
  },
  NO_THUMBNAIL_PRESENT: {
    name: 'NO_THUMBNAIL_PRESENT',
    code: 0x2010,
    description: 'indicates that a data object exists with the specified ObjectHandle, but the data object does not contain a producible thumbnail',
  },
  SELF_TEST_FAILED: {
    name: 'SELF_TEST_FAILED',
    code: 0x2011,
    description: 'indicates that the device failed an internal device-specific self-test',
  },
  PARTIAL_DELETION: {
    name: 'PARTIAL_DELETION',
    code: 0x2012,
    description: 'indicates that only a subset of the objects indicated for deletion has actually been deleted, due to the fact that some were write-protected, or that some objects were on stores that are read-only',
  },
  STORE_NOT_AVAILABLE: {
    name: 'STORE_NOT_AVAILABLE',
    code: 0x2013,
    description: 'indicates that the store indicated (or the store that contains the indicated object) is not physically available. This can be caused by media ejection. This response shall not be used to indicate that the store is busy, as described in 11.3.25',
  },
  SPECIFICATION_BY_FORMAT_UNSUPPORTED: {
    name: 'SPECIFICATION_BY_FORMAT_UNSUPPORTED',
    code: 0x2014,
    description: 'indicates that the operation attempted to specify action only on objects of a particular format, and that capability is unsupported. The operation should be re-attempted without specifying by format. Any response of this nature infers that any future attempt to specify by format with the indicated operation will result in the same response',
  },
  NO_VALID_OBJECT_INFO: {
    name: 'NO_VALID_OBJECT_INFO',
    code: 0x2015,
    description: 'indicates that the initiator attempted to issue a SendObject operation without having previously sent a corresponding SendObjectInfo successfully. The initiator should successfully complete a SendObjectInfo operation before attempting another SendObject operation',
  },
  INVALID_CODE_FORMAT: {
    name: 'INVALID_CODE_FORMAT',
    code: 0x2016,
    description: 'indicates that the indicated data code does not have the correct format, and is therefore invalid. This response is used when the Most Significant Nibble of a datacode does not have the format required for that type of code',
  },
  UNKNOWN_VENDOR_CODE: {
    name: 'UNKNOWN_VENDOR_CODE',
    code: 0x2017,
    description: 'indicates that the indicated data code has the correct format, but has bit15 set to 1. Therefore, the code is a vendor-extended code, and this device does not know how to handle the indicated code. This response should typically not occur, as the supported vendor extensions should be identifiable by examination of the VendorExtensionID and VendorExtensionVersion fields in the DeviceInfo data set',
  },
  CAPTURE_ALREADY_TERMINATED: {
    name: 'CAPTURE_ALREADY_TERMINATED',
    code: 0x2018,
    description: 'indicates that an operation is attempting to terminate a capture session initiated by a preceding InitiateOpenCapture operation, and that the preceding operation has already terminated. This response is only used for the TerminateOpenCapture operation, which is only used for open-ended captures. Subclause 10.5.24 provides a description of the TerminateOpenCapture operation',
  },
  DEVICE_BUSY: {
    name: 'DEVICE_BUSY',
    code: 0x2019,
    description: 'indicates that the device is not currently able to process a request because it, or the specified store, is busy. The intent of this response is to imply that perhaps at a future time, the operation should be re-requested. This response shall not be used to indicate that a store is physically unavailable, as described in 11.3.19',
  },
  INVALID_PARENT_OBJECT: {
    name: 'INVALID_PARENT_OBJECT',
    code: 0x201A,
    description: 'indicates that the indicated object is not of type Association, and therefore is not a valid ParentObject. This response is not intended to be used for specified ObjectHandles that do not refer to valid objects, which are handled instead by the Invalid_ObjectHandle response described in 11.3.9',
  },
  INVALID_DEVICE_PROP_FORMAT: {
    name: 'INVALID_DEVICE_PROP_FORMAT',
    code: 0x201B,
    description: 'indicates that an attempt was made to set a DeviceProperty, but the DevicePropDesc data set is not the correct size or format',
  },
  INVALID_DEVICE_PROP_VALUE: {
    name: 'INVALID_DEVICE_PROP_VALUE',
    code: 0x201C,
    description: 'indicates that an attempt was made to set a DeviceProperty to a value that is not permitted by the device',
  },
  INVALID_PARAMETER: {
    name: 'INVALID_PARAMETER',
    code: 0x201D,
    description: 'indicates that a parameter was specified in conjunction with the operation, and that although a parameter was expected, the value of the parameter is not a legal value. This response is distinctly different from Parameter_Not_Supported, as described in 11.3.6',
  },
  SESSION_ALREADY_OPEN: {
    name: 'SESSION_ALREADY_OPEN',
    code: 0x201E,
    description: 'this response code may be used as the response to an OpenSession operation. For multisession devices/transports, this response indicates that a session with the specified SessionID is already open. For single-session devices/transports, this response indicates that a session is open and must be closed before another session can be opened',
  },
  TRANSACTION_CANCELLED: {
    name: 'TRANSACTION_CANCELLED',
    code: 0x201F,
    description: 'this response code may be used to indicate that the operation was interrupted due to manual cancellation by the opposing device',
  },
  SPECIFICATION_OF_DESTINATION_UNSUPPORTED: {
    name: 'SPECIFICATION_OF_DESTINATION_UNSUPPORTED',
    code: 0x2020,
    description: 'this response code may be used as the response to a SendObjectInfo operation to indicate that the responder does not support specification of the destination by the initiator. This response infers that the initiator should not attempt to specify the object destination in any future SendObjectInfo operations, as they will also fail with the same response',
  },
  INVALID_ENUM_ID: {
    name: 'INVALID_ENUM_ID',
    code: 0x2021,
    description: 'this response code may be used as the response to an EnumHandles or StopEnumHandles operation, when the indicated EnumID parameter is invalid, such as when there is no active enumeration process (i.e. no previous successful invocation of StartEnumHandles)',
  },
  NO_STREAM_ENABLED: {
    name: 'NO_STREAM_ENABLED',
    code: 0x2022,
    description: 'this response code may be used to indicate that a streaming operation was started without having any streams enabled. This indicates that the initiator should enable one (or more) stream(s) on the responder prior to calling off GetStream operation',
  },
  INVALID_DATA_SET: {
    name: 'INVALID_DATA_SET',
    code: 0x2023,
    description: 'this response code may be used to indicate that a data set is invalid, due to being malformed, having an incorrect size or an invalid field',
  }
} as const satisfies ResponseDefinition

export type PTPResponseDefinitions = typeof PTPResponses