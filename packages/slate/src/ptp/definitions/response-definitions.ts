import { ResponseDefinition } from '@ptp/types/response'

export const responseRegistry = {
    Undefined: { code: 0x2000, name: 'Undefined', description: 'Undefined response' },
    OK: { code: 0x2001, name: 'OK', description: 'Operation completed successfully' },
    GeneralError: { code: 0x2002, name: 'GeneralError', description: 'Operation did not complete, unknown error' },
    SessionNotOpen: {
        code: 0x2003,
        name: 'SessionNotOpen',
        description: 'Session handle is not a currently open session',
    },
    InvalidTransactionID: {
        code: 0x2004,
        name: 'InvalidTransactionID',
        description: 'TransactionID is zero or does not refer to a valid transaction',
    },
    OperationNotSupported: {
        code: 0x2005,
        name: 'OperationNotSupported',
        description: 'OperationCode appears valid but responder does not support it',
    },
    ParameterNotSupported: {
        code: 0x2006,
        name: 'ParameterNotSupported',
        description: 'Non-zero parameter specified but not used for this operation',
    },
    IncompleteTransfer: {
        code: 0x2007,
        name: 'IncompleteTransfer',
        description: 'Transfer did not complete, data should be discarded',
    },
    InvalidStorageID: {
        code: 0x2008,
        name: 'InvalidStorageID',
        description: 'StorageID does not refer to a valid store on the device',
    },
    InvalidObjectHandle: {
        code: 0x2009,
        name: 'InvalidObjectHandle',
        description: 'ObjectHandle does not refer to a valid object on the device',
    },
    DevicePropNotSupported: {
        code: 0x200a,
        name: 'DevicePropNotSupported',
        description: 'DevicePropCode appears valid but not supported by device',
    },
    InvalidObjectFormatCode: {
        code: 0x200b,
        name: 'InvalidObjectFormatCode',
        description: 'Device does not support the ObjectFormatCode in this context',
    },
    StoreFull: { code: 0x200c, name: 'StoreFull', description: 'Store referred to by operation is full' },
    ObjectWriteProtected: {
        code: 0x200d,
        name: 'ObjectWriteProtected',
        description: 'Object referred to by operation is write-protected',
    },
    StoreReadOnly: { code: 0x200e, name: 'StoreReadOnly', description: 'Store referred to by operation is read-only' },
    AccessDenied: { code: 0x200f, name: 'AccessDenied', description: 'Access to data has been denied' },
    NoThumbnailPresent: {
        code: 0x2010,
        name: 'NoThumbnailPresent',
        description: 'Object exists but contains no producible thumbnail',
    },
    SelfTestFailed: { code: 0x2011, name: 'SelfTestFailed', description: 'Device failed internal self-test' },
    PartialDeletion: { code: 0x2012, name: 'PartialDeletion', description: 'Only a subset of objects were deleted' },
    StoreNotAvailable: { code: 0x2013, name: 'StoreNotAvailable', description: 'Store is not physically available' },
    SpecificationByFormatUnsupported: {
        code: 0x2014,
        name: 'SpecificationByFormatUnsupported',
        description: 'Operation cannot specify action by format',
    },
    NoValidObjectInfo: {
        code: 0x2015,
        name: 'NoValidObjectInfo',
        description: 'SendObject attempted without successful SendObjectInfo',
    },
    InvalidCodeFormat: {
        code: 0x2016,
        name: 'InvalidCodeFormat',
        description: 'Data code does not have correct format',
    },
    UnknownVendorCode: {
        code: 0x2017,
        name: 'UnknownVendorCode',
        description: 'Vendor-extended code not supported by device',
    },
    CaptureAlreadyTerminated: {
        code: 0x2018,
        name: 'CaptureAlreadyTerminated',
        description: 'Capture session already terminated',
    },
    DeviceBusy: { code: 0x2019, name: 'DeviceBusy', description: 'Device or store is busy' },
    InvalidParentObject: {
        code: 0x201a,
        name: 'InvalidParentObject',
        description: 'Object is not of type Association',
    },
    InvalidDevicePropFormat: {
        code: 0x201b,
        name: 'InvalidDevicePropFormat',
        description: 'DevicePropDesc data set is incorrect size or format',
    },
    InvalidDevicePropValue: {
        code: 0x201c,
        name: 'InvalidDevicePropValue',
        description: 'DeviceProperty value not permitted by device',
    },
    InvalidParameter: { code: 0x201d, name: 'InvalidParameter', description: 'Parameter value is not legal' },
    SessionAlreadyOpen: { code: 0x201e, name: 'SessionAlreadyOpen', description: 'Session is already open' },
    TransactionCancelled: {
        code: 0x201f,
        name: 'TransactionCancelled',
        description: 'Operation interrupted by manual cancellation',
    },
    SpecificationOfDestinationUnsupported: {
        code: 0x2020,
        name: 'SpecificationOfDestinationUnsupported',
        description: 'Responder does not support initiator-specified destination',
    },
    InvalidEnumHandle: { code: 0x2021, name: 'InvalidEnumHandle', description: 'EnumID parameter is invalid' },
    NoStreamEnabled: {
        code: 0x2022,
        name: 'NoStreamEnabled',
        description: 'Streaming operation started without enabled streams',
    },
    InvalidDataset: {
        code: 0x2023,
        name: 'InvalidDataset',
        description: 'Data set is malformed or has incorrect size',
    },
} as const satisfies Record<string, ResponseDefinition>

export const {
    OK,
    SessionAlreadyOpen,
    DeviceBusy,
    IncompleteTransfer,
    OperationNotSupported,
    DevicePropNotSupported,
    AccessDenied,
} = responseRegistry

export type ResponseRegistry = typeof responseRegistry
