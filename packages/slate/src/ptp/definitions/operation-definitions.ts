import { DeviceInfoCodec } from '@ptp/datasets/device-info-dataset'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { ObjectInfoCodec } from '@ptp/datasets/object-info-dataset'
import { StorageInfoCodec } from '@ptp/datasets/storage-info-dataset'
import { ArrayCodec, baseCodecs, type PTPRegistry } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

export const genericOperationRegistry = {
    /** MTP object-property operations, also advertised by Fujifilm RAW-conversion mode.
     * Shapes and direction: libgphoto2 ptp.c, ptp_mtp_getobjectpropssupported/getobjectpropdesc/
     * getobjectpropvalue/getobjectproplist_generic at 02d92fea8a269eb94330a4eade204ba799433606.
     * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.c
     */
    MtpGetObjectPropsSupported: {
        code: 0x9801,
        name: 'MtpGetObjectPropsSupported',
        description: 'MTP object property query; returns the original dataset bytes.',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectFormatCode', description: 'ObjectFormatCode', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    MtpGetObjectPropDesc: {
        code: 0x9802,
        name: 'MtpGetObjectPropDesc',
        description: 'MTP object property query; returns the original dataset bytes.',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectPropertyCode', description: 'ObjectPropertyCode', codec: baseCodecs.uint32, required: true },
            { name: 'ObjectFormatCode', description: 'ObjectFormatCode', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    MtpGetObjectPropValue: {
        code: 0x9803,
        name: 'MtpGetObjectPropValue',
        description: 'MTP object property query; returns the original dataset bytes.',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectHandle', description: 'ObjectHandle', codec: baseCodecs.uint32, required: true },
            { name: 'ObjectPropertyCode', description: 'ObjectPropertyCode', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    MtpGetObjectPropList: {
        code: 0x9805,
        name: 'MtpGetObjectPropList',
        description: 'MTP object property query; returns the original dataset bytes.',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectHandle', description: 'ObjectHandle', codec: baseCodecs.uint32, required: true },
            { name: 'ObjectFormatCode', description: 'ObjectFormatCode', codec: baseCodecs.uint32, required: true },
            { name: 'ObjectPropertyCode', description: 'ObjectPropertyCode', codec: baseCodecs.uint32, required: true },
            { name: 'GroupCode', description: 'GroupCode', codec: baseCodecs.uint32, required: true },
            { name: 'Depth', description: 'Depth', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    Undefined: {
        code: 0x1000,
        name: 'Undefined',
        description: 'Undefined operation',
        dataDirection: 'none',
        operationParameters: [],
        responseParameters: [],
    },
    GetDeviceInfo: {
        code: 0x1001,
        name: 'GetDeviceInfo',
        description: 'Returns information and capabilities about the responder device',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new DeviceInfoCodec(registry),
        operationParameters: [],
        responseParameters: [],
    },
    OpenSession: {
        code: 0x1002,
        name: 'OpenSession',
        description: 'Opens a session with the device',
        dataDirection: 'none',
        operationParameters: [
            { name: 'SessionID', description: 'Session identifier', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    CloseSession: {
        code: 0x1003,
        name: 'CloseSession',
        description: 'Closes the current session',
        dataDirection: 'none',
        operationParameters: [],
        responseParameters: [],
    },
    GetStorageIDs: {
        code: 0x1004,
        name: 'GetStorageIDs',
        description: 'Returns list of currently valid StorageIDs',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new ArrayCodec(registry, registry.codecs.uint32),
        operationParameters: [],
        responseParameters: [],
    },
    GetStorageInfo: {
        code: 0x1005,
        name: 'GetStorageInfo',
        description: 'Returns StorageInfo data set for a storage area',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new StorageInfoCodec(registry),
        operationParameters: [
            { name: 'StorageID', description: 'Storage identifier', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    GetNumObjects: {
        code: 0x1006,
        name: 'GetNumObjects',
        description: 'Returns number of objects in storage',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'StorageID',
                description: 'Storage identifier (0xFFFFFFFF for all)',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'ObjectFormatCode',
                description: 'Filter by format code',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
            {
                name: 'ParentObject',
                description: 'Parent association handle',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
        ],
        responseParameters: [
            { name: 'NumObjects', description: 'Number of objects', codec: baseCodecs.uint32, required: true },
        ],
    },
    GetObjectHandles: {
        code: 0x1007,
        name: 'GetObjectHandles',
        description: 'Returns array of ObjectHandles in storage',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new ArrayCodec(registry, registry.codecs.uint32),
        operationParameters: [
            {
                name: 'StorageID',
                description: 'Storage identifier (0xFFFFFFFF for all)',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'ObjectFormatCode',
                description: 'Filter by format code',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
            {
                name: 'ParentObject',
                description: 'Parent association handle',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
        ],
        responseParameters: [],
    },
    GetObjectInfo: {
        code: 0x1008,
        name: 'GetObjectInfo',
        description: 'Returns ObjectInfo data set for an object',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new ObjectInfoCodec(registry),
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object handle', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    GetObject: {
        code: 0x1009,
        name: 'GetObject',
        description: 'Retrieves one object from the device',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object handle', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    GetThumb: {
        code: 0x100a,
        name: 'GetThumb',
        description: 'Retrieves thumbnail for an object',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object handle', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    DeleteObject: {
        code: 0x100b,
        name: 'DeleteObject',
        description: 'Deletes an object from the device',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'ObjectHandle',
                description: 'Object handle (0xFFFFFFFF for all)',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'ObjectFormatCode',
                description: 'Filter by format code',
                codec: baseCodecs.uint32,
                required: false,
            },
        ],
        responseParameters: [],
    },
    SendObjectInfo: {
        code: 0x100c,
        name: 'SendObjectInfo',
        description: 'Sends ObjectInfo before sending object',
        dataDirection: 'in',
        operationParameters: [
            {
                name: 'StorageID',
                description: 'Destination storage',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
            {
                name: 'ParentObjectHandle',
                description: 'Parent object handle',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
        ],
        responseParameters: [
            { name: 'StorageID', description: 'Actual storage ID', codec: baseCodecs.uint32, required: true },
            {
                name: 'ParentObjectHandle',
                description: 'Actual parent handle',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'ObjectHandle',
                description: 'Reserved handle for object',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
    },
    SendObject: {
        code: 0x100d,
        name: 'SendObject',
        description: 'Sends object data to the device',
        dataDirection: 'in',
        operationParameters: [],
        responseParameters: [],
    },
    InitiateCapture: {
        code: 0x100e,
        name: 'InitiateCapture',
        description: 'Initiates capture of new data objects',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'StorageID',
                description: 'Storage for capture',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
            {
                name: 'ObjectFormatCode',
                description: 'Format for capture',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
        ],
        responseParameters: [],
    },
    FormatStore: {
        code: 0x100f,
        name: 'FormatStore',
        description: 'Formats a storage device',
        dataDirection: 'none',
        operationParameters: [
            { name: 'StorageID', description: 'Storage to format', codec: baseCodecs.uint32, required: true },
            {
                name: 'FilesystemType',
                description: 'Filesystem type',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
        ],
        responseParameters: [],
    },
    ResetDevice: {
        code: 0x1010,
        name: 'ResetDevice',
        description: 'Resets device to default state',
        dataDirection: 'none',
        operationParameters: [],
        responseParameters: [],
    },
    SelfTest: {
        code: 0x1011,
        name: 'SelfTest',
        description: 'Performs device self-test',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'SelfTestType',
                description: 'Type of self-test',
                codec: baseCodecs.uint32,
                required: false,
                defaultValue: 0,
            },
        ],
        responseParameters: [],
    },
    SetObjectProtection: {
        code: 0x1012,
        name: 'SetObjectProtection',
        description: 'Sets object protection status',
        dataDirection: 'none',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object handle', codec: baseCodecs.uint32, required: true },
            { name: 'ProtectionStatus', description: 'Protection status', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    PowerDown: {
        code: 0x1013,
        name: 'PowerDown',
        description: 'Powers down the device',
        dataDirection: 'none',
        operationParameters: [],
        responseParameters: [],
    },
    GetDevicePropDesc: {
        code: 0x1014,
        name: 'GetDevicePropDesc',
        description: 'Gets device property descriptor',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new DevicePropDescCodec(registry, false),
        operationParameters: [
            { name: 'DevicePropCode', description: 'Property code', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    GetDevicePropValue: {
        code: 0x1015,
        name: 'GetDevicePropValue',
        description: 'Gets device property value',
        dataDirection: 'out',
        operationParameters: [
            { name: 'DevicePropCode', description: 'Property code', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    SetDevicePropValue: {
        code: 0x1016,
        name: 'SetDevicePropValue',
        description: 'Sets device property value',
        dataDirection: 'in',
        operationParameters: [
            { name: 'DevicePropCode', description: 'Property code', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    ResetDevicePropValue: {
        code: 0x1017,
        name: 'ResetDevicePropValue',
        description: 'Resets device property to default',
        dataDirection: 'none',
        operationParameters: [
            { name: 'DevicePropCode', description: 'Property code', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    TerminateOpenCapture: {
        code: 0x1018,
        name: 'TerminateOpenCapture',
        description: 'Terminates an open capture',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'TransactionID',
                description: 'Transaction ID of capture',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
    MoveObject: {
        code: 0x1019,
        name: 'MoveObject',
        description: 'Moves object to new location',
        dataDirection: 'none',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object to move', codec: baseCodecs.uint32, required: true },
            { name: 'StorageID', description: 'Destination storage', codec: baseCodecs.uint32, required: true },
            { name: 'ParentObjectHandle', description: 'New parent object', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    CopyObject: {
        code: 0x101a,
        name: 'CopyObject',
        description: 'Copies object to new location',
        dataDirection: 'none',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object to copy', codec: baseCodecs.uint32, required: true },
            { name: 'StorageID', description: 'Destination storage', codec: baseCodecs.uint32, required: true },
            { name: 'ParentObjectHandle', description: 'New parent object', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [
            { name: 'ObjectHandle', description: 'Handle of new copy', codec: baseCodecs.uint32, required: true },
        ],
    },
    GetPartialObject: {
        code: 0x101b,
        name: 'GetPartialObject',
        description: 'Gets partial object data',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Object handle', codec: baseCodecs.uint32, required: true },
            { name: 'Offset', description: 'Offset in bytes', codec: baseCodecs.uint32, required: true },
            { name: 'MaxBytes', description: 'Maximum bytes to return', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [
            { name: 'ActualBytes', description: 'Actual bytes returned', codec: baseCodecs.uint32, required: true },
        ],
    },
    InitiateOpenCapture: {
        code: 0x101c,
        name: 'InitiateOpenCapture',
        description: 'Initiates open-ended capture',
        dataDirection: 'none',
        operationParameters: [
            { name: 'StorageID', description: 'Storage for capture', codec: baseCodecs.uint32, required: true },
            { name: 'ObjectFormatCode', description: 'Format for capture', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    StartEnumHandles: {
        code: 0x101d,
        name: 'StartEnumHandles',
        description: 'Initiates an enumeration process for retrieving object handles in chunks (PTP v1.1)',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'StorageID',
                description: 'Storage ID or 0xFFFFFFFF for all stores',
                codec: baseCodecs.uint32,
                required: false,
            },
            {
                name: 'ObjectFormatCode',
                description: 'Filter by format or 0xFFFFFFFF for images only',
                codec: baseCodecs.uint32,
                required: false,
            },
            {
                name: 'ParentObjectHandle',
                description: 'Parent association or 0xFFFFFFFF for root',
                codec: baseCodecs.uint32,
                required: false,
            },
        ],
        responseParameters: [
            { name: 'EnumID', description: 'Unique enumeration identifier', codec: baseCodecs.uint32, required: true },
        ],
    },
    EnumHandles: {
        code: 0x101e,
        name: 'EnumHandles',
        description: 'Returns a chunk of object handles from an active enumeration (PTP v1.1)',
        dataDirection: 'out',
        dataCodec: (registry: PTPRegistry) => new ArrayCodec(registry, registry.codecs.uint32),
        operationParameters: [
            {
                name: 'EnumID',
                description: 'Enumeration identifier from StartEnumHandles',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'MaxNumberHandles',
                description: 'Maximum number of handles to return',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
    StopEnumHandles: {
        code: 0x101f,
        name: 'StopEnumHandles',
        description: 'Closes an active enumeration process (PTP v1.1)',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'EnumID',
                description: 'Enumeration identifier to close',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
    GetVendorExtensionMaps: {
        code: 0x1020,
        name: 'GetVendorExtensionMaps',
        description: 'Retrieves mapping of vendor extensions (PTP v1.1)',
        dataDirection: 'out',
        operationParameters: [],
        responseParameters: [],
    },
    GetVendorDeviceInfo: {
        code: 0x1021,
        name: 'GetVendorDeviceInfo',
        description: 'Retrieves DeviceInfo for a specific vendor extension (PTP v1.1)',
        dataDirection: 'out',
        operationParameters: [
            { name: 'VendorExtensionID', description: 'Vendor extension ID', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    GetResizedImageObject: {
        code: 0x1022,
        name: 'GetResizedImageObject',
        description: 'Retrieves an image object at arbitrary resolution (PTP v1.1)',
        dataDirection: 'out',
        operationParameters: [
            { name: 'ObjectHandle', description: 'Image object handle', codec: baseCodecs.uint32, required: true },
            { name: 'ImageWidth', description: 'Desired width in pixels', codec: baseCodecs.uint32, required: true },
            {
                name: 'ImageHeight',
                description: 'Desired height in pixels (0 to maintain aspect ratio)',
                codec: baseCodecs.uint32,
                required: false,
            },
        ],
        responseParameters: [
            { name: 'ActualBytes', description: 'Number of bytes sent', codec: baseCodecs.uint32, required: true },
            { name: 'ActualWidth', description: 'Actual width in pixels', codec: baseCodecs.uint32, required: true },
            { name: 'ActualHeight', description: 'Actual height in pixels', codec: baseCodecs.uint32, required: true },
        ],
    },
    GetFilesystemManifest: {
        code: 0x1023,
        name: 'GetFilesystemManifest',
        description: 'Retrieves filesystem information in a single transaction (PTP v1.1)',
        dataDirection: 'out',
        operationParameters: [
            {
                name: 'StorageID',
                description: 'Storage ID or 0xFFFFFFFF for all stores',
                codec: baseCodecs.uint32,
                required: true,
            },
            { name: 'ObjectFormatCode', description: 'Filter by format', codec: baseCodecs.uint32, required: false },
            {
                name: 'ParentObjectHandle',
                description: 'Parent association handle',
                codec: baseCodecs.uint32,
                required: false,
            },
        ],
        responseParameters: [],
    },
    GetStreamInfo: {
        code: 0x1024,
        name: 'GetStreamInfo',
        description: 'Retrieves information about a stream (PTP v1.1)',
        dataDirection: 'out',
        operationParameters: [
            { name: 'StreamType', description: 'Type of stream', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
    GetStream: {
        code: 0x1025,
        name: 'GetStream',
        description: 'Retrieves streaming content (PTP v1.1)',
        dataDirection: 'out',
        operationParameters: [
            { name: 'StreamType', description: 'Type of stream', codec: baseCodecs.uint32, required: true },
        ],
        responseParameters: [],
    },
} as const satisfies { [key: string]: OperationDefinition }

export const {
    GetDevicePropDesc,
    GetDeviceInfo,
    SetDevicePropValue,
    GetObjectHandles,
    GetObjectInfo,
    GetStorageIDs,
    GetThumb,
    OpenSession,
} = genericOperationRegistry

export type GenericOperationDef = (typeof genericOperationRegistry)[keyof typeof genericOperationRegistry]
