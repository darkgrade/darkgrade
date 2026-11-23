import { ResponseDefinition } from '@ptp/types/response'

export const Undefined = {
    code: 0x2000,
    name: 'Undefined',
    description: 'Undefined response',
} as const satisfies ResponseDefinition

export const OK = {
    code: 0x2001,
    name: 'OK',
    description: 'Operation completed successfully',
} as const satisfies ResponseDefinition

export const GeneralError = {
    code: 0x2002,
    name: 'GeneralError',
    description: 'Operation did not complete, unknown error',
} as const satisfies ResponseDefinition

export const SessionNotOpen = {
    code: 0x2003,
    name: 'SessionNotOpen',
    description: 'Session handle is not a currently open session',
} as const satisfies ResponseDefinition

export const InvalidTransactionID = {
    code: 0x2004,
    name: 'InvalidTransactionID',
    description: 'TransactionID is zero or does not refer to a valid transaction',
} as const satisfies ResponseDefinition

export const OperationNotSupported = {
    code: 0x2005,
    name: 'OperationNotSupported',
    description: 'OperationCode appears valid but responder does not support it',
} as const satisfies ResponseDefinition

export const ParameterNotSupported = {
    code: 0x2006,
    name: 'ParameterNotSupported',
    description: 'Non-zero parameter specified but not used for this operation',
} as const satisfies ResponseDefinition

export const IncompleteTransfer = {
    code: 0x2007,
    name: 'IncompleteTransfer',
    description: 'Transfer did not complete, data should be discarded',
} as const satisfies ResponseDefinition

export const InvalidStorageID = {
    code: 0x2008,
    name: 'InvalidStorageID',
    description: 'StorageID does not refer to a valid store on the device',
} as const satisfies ResponseDefinition

export const InvalidObjectHandle = {
    code: 0x2009,
    name: 'InvalidObjectHandle',
    description: 'ObjectHandle does not refer to a valid object on the device',
} as const satisfies ResponseDefinition

export const DevicePropNotSupported = {
    code: 0x200a,
    name: 'DevicePropNotSupported',
    description: 'DevicePropCode appears valid but not supported by device',
} as const satisfies ResponseDefinition

export const InvalidObjectFormatCode = {
    code: 0x200b,
    name: 'InvalidObjectFormatCode',
    description: 'Device does not support the ObjectFormatCode in this context',
} as const satisfies ResponseDefinition

export const StoreFull = {
    code: 0x200c,
    name: 'StoreFull',
    description: 'Store referred to by operation is full',
} as const satisfies ResponseDefinition

export const ObjectWriteProtected = {
    code: 0x200d,
    name: 'ObjectWriteProtected',
    description: 'Object referred to by operation is write-protected',
} as const satisfies ResponseDefinition

export const StoreReadOnly = {
    code: 0x200e,
    name: 'StoreReadOnly',
    description: 'Store referred to by operation is read-only',
} as const satisfies ResponseDefinition

export const AccessDenied = {
    code: 0x200f,
    name: 'AccessDenied',
    description: 'Access to data has been denied',
} as const satisfies ResponseDefinition

export const NoThumbnailPresent = {
    code: 0x2010,
    name: 'NoThumbnailPresent',
    description: 'Object exists but contains no producible thumbnail',
} as const satisfies ResponseDefinition

export const SelfTestFailed = {
    code: 0x2011,
    name: 'SelfTestFailed',
    description: 'Device failed internal self-test',
} as const satisfies ResponseDefinition

export const PartialDeletion = {
    code: 0x2012,
    name: 'PartialDeletion',
    description: 'Only a subset of objects were deleted',
} as const satisfies ResponseDefinition

export const StoreNotAvailable = {
    code: 0x2013,
    name: 'StoreNotAvailable',
    description: 'Store is not physically available',
} as const satisfies ResponseDefinition

export const SpecificationByFormatUnsupported = {
    code: 0x2014,
    name: 'SpecificationByFormatUnsupported',
    description: 'Operation cannot specify action by format',
} as const satisfies ResponseDefinition

export const NoValidObjectInfo = {
    code: 0x2015,
    name: 'NoValidObjectInfo',
    description: 'SendObject attempted without successful SendObjectInfo',
} as const satisfies ResponseDefinition

export const InvalidCodeFormat = {
    code: 0x2016,
    name: 'InvalidCodeFormat',
    description: 'Data code does not have correct format',
} as const satisfies ResponseDefinition

export const UnknownVendorCode = {
    code: 0x2017,
    name: 'UnknownVendorCode',
    description: 'Vendor-extended code not supported by device',
} as const satisfies ResponseDefinition

export const CaptureAlreadyTerminated = {
    code: 0x2018,
    name: 'CaptureAlreadyTerminated',
    description: 'Capture session already terminated',
} as const satisfies ResponseDefinition

export const DeviceBusy = {
    code: 0x2019,
    name: 'DeviceBusy',
    description: 'Device or store is busy',
} as const satisfies ResponseDefinition

export const InvalidParentObject = {
    code: 0x201a,
    name: 'InvalidParentObject',
    description: 'Object is not of type Association',
} as const satisfies ResponseDefinition

export const InvalidDevicePropFormat = {
    code: 0x201b,
    name: 'InvalidDevicePropFormat',
    description: 'DevicePropDesc data set is incorrect size or format',
} as const satisfies ResponseDefinition

export const InvalidDevicePropValue = {
    code: 0x201c,
    name: 'InvalidDevicePropValue',
    description: 'DeviceProperty value not permitted by device',
} as const satisfies ResponseDefinition

export const InvalidParameter = {
    code: 0x201d,
    name: 'InvalidParameter',
    description: 'Parameter value is not legal',
} as const satisfies ResponseDefinition

export const SessionAlreadyOpen = {
    code: 0x201e,
    name: 'SessionAlreadyOpen',
    description: 'Session is already open',
} as const satisfies ResponseDefinition

export const TransactionCancelled = {
    code: 0x201f,
    name: 'TransactionCancelled',
    description: 'Operation interrupted by manual cancellation',
} as const satisfies ResponseDefinition

export const SpecificationOfDestinationUnsupported = {
    code: 0x2020,
    name: 'SpecificationOfDestinationUnsupported',
    description: 'Responder does not support initiator-specified destination',
} as const satisfies ResponseDefinition

export const InvalidEnumHandle = {
    code: 0x2021,
    name: 'InvalidEnumHandle',
    description: 'EnumID parameter is invalid',
} as const satisfies ResponseDefinition

export const NoStreamEnabled = {
    code: 0x2022,
    name: 'NoStreamEnabled',
    description: 'Streaming operation started without enabled streams',
} as const satisfies ResponseDefinition

export const InvalidDataset = {
    code: 0x2023,
    name: 'InvalidDataset',
    description: 'Data set is malformed or has incorrect size',
} as const satisfies ResponseDefinition

export const responseRegistry = {
    Undefined,
    OK,
    GeneralError,
    SessionNotOpen,
    InvalidTransactionID,
    OperationNotSupported,
    ParameterNotSupported,
    IncompleteTransfer,
    InvalidStorageID,
    InvalidObjectHandle,
    DevicePropNotSupported,
    InvalidObjectFormatCode,
    StoreFull,
    ObjectWriteProtected,
    StoreReadOnly,
    AccessDenied,
    NoThumbnailPresent,
    SelfTestFailed,
    PartialDeletion,
    StoreNotAvailable,
    SpecificationByFormatUnsupported,
    NoValidObjectInfo,
    InvalidCodeFormat,
    UnknownVendorCode,
    CaptureAlreadyTerminated,
    DeviceBusy,
    InvalidParentObject,
    InvalidDevicePropFormat,
    InvalidDevicePropValue,
    InvalidParameter,
    SessionAlreadyOpen,
    TransactionCancelled,
    SpecificationOfDestinationUnsupported,
    InvalidEnumHandle,
    NoStreamEnabled,
    InvalidDataset,
} as const satisfies Record<string, ResponseDefinition>

export type ResponseRegistry = typeof responseRegistry
