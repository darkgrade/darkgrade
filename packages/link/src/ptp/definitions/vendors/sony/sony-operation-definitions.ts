import { SDIExtDevicePropInfoCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'
import { baseCodecs, createEnumCodec } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

export const SDIO_OpenSession = {
    code: 0x9210,
    name: 'SDIO_OpenSession',
    description: 'Open Session with Function Mode.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'SessionId',
            description: 'Unique session identifier',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'FunctionMode',
            description: 'Function mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'REMOTE', description: 'Remote Control Mode' },
                        { value: 0x00000001, name: 'CONTENT_TRANSFER', description: 'Content Transfer Mode' },
                        {
                            value: 0x00000002,
                            name: 'REMOTE_AND_CONTENT_TRANSFER',
                            description: 'Remote Control with Transfer Mode',
                        },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_Connect = {
    code: 0x9201,
    name: 'SDIO_Connect',
    description: 'This is for the Sony SDIO authentication handshake.',
    dataDirection: 'out',
    dataCodec: registry => registry.codecs.uint64,
    operationParameters: [
        {
            name: 'phaseType',
            description: 'Connection phase (1, 2, or 3)',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x01, name: 'PHASE_1', description: 'Authentication Phase 1' },
                        { value: 0x02, name: 'PHASE_2', description: 'Authentication Phase 2' },
                        { value: 0x03, name: 'PHASE_3', description: 'Authentication Phase 3' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
        {
            name: 'keyCode1',
            description: 'KeyCode1 (always 0x00000000)',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [{ value: 0x00000000, name: 'DEFAULT', description: 'Default key code' }] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
        {
            name: 'keyCode2',
            description: 'KeyCode2 (always 0x00000000)',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [{ value: 0x00000000, name: 'DEFAULT', description: 'Default key code' }] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetExtDeviceInfo = {
    code: 0x9202,
    name: 'SDIO_GetExtDeviceInfo',
    description: 'Get the protocol version and the supported properties of the connected device.',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'initiatorVersion',
            description: 'Initiator Protocol Version',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [{ value: 0x012c, name: '3.00', description: 'Protocol Version 3.00' }] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
        {
            name: 'flagOfDevicePropertyOption',
            description: 'Enables extended SDIO Device Property / SDIControlCode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetExtDevicePropValue = {
    code: 0x9251,
    name: 'SDIO_GetExtDevicePropValue',
    description: 'Get the DevicePropInfo.',
    dataDirection: 'out',
    dataCodec: registry => new SDIExtDevicePropInfoCodec(registry),
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code to get',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_SetExtDevicePropValue = {
    code: 0x9205,
    name: 'SDIO_SetExtDevicePropValue',
    description: 'Set a DevicePropValue for a device property.',
    dataDirection: 'in',
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code to set',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'flagOfDevicePropertyOption',
            description: 'Enables extended SDIO Device Property / SDIControlCode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_ControlDevice = {
    code: 0x9207,
    name: 'SDIO_ControlDevice',
    description: 'Set the SDIControl value for the SDIControlCode.',
    dataDirection: 'in',
    operationParameters: [
        {
            name: 'sdiControlCode',
            description: 'Control property code',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'flagOfDevicePropertyOption',
            description: 'Enables extended SDIO Device Property / SDIControlCode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetAllExtDevicePropInfo = {
    code: 0x9209,
    name: 'SDIO_GetAllExtDevicePropInfo',
    description:
        'Obtain all support DevicePropDescs at one time. The host will send this operation at regular intervals to obtain the latest (current) camera settings.',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'flagOfGetOnlyDifferenceData',
            description: 'Flag of get only difference data',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'flagOfDevicePropertyOption',
            description: 'Enables extended SDIO Device Property / SDIControlCode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetOsdImage = {
    code: 0x9238,
    name: 'SDIO_GetOsdImage',
    description: 'Get OSD image',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetPartialLargeObject = {
    code: 0x9211,
    name: 'SDIO_GetPartialLargeObject',
    description:
        'Get partial object from the device. Same as GetPartialObject on PIMA 15740 but with 64-bit offset support.',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'ObjectHandle',
            description: 'Object handle',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'OffsetLower',
            description: 'Offset in bytes (lower 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'OffsetUpper',
            description: 'Offset in bytes (upper 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'MaxBytes',
            description: 'Maximum number of bytes to obtain (does not support 0xFFFFFFFF)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [
        {
            name: 'ActualBytesSent',
            description: 'Actual number of bytes sent',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
} as const satisfies OperationDefinition

export const SDIO_SetContentsTransferMode = {
    code: 0x9212,
    name: 'SDIO_SetContentsTransferMode',
    description: 'Enable content transfer mode to access memory card content.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'ContentsSelectType',
            description: 'The Initiator should send this command with one of the following values:',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'INVALID', description: 'INVALID' },
                        { value: 0x00000001, name: 'CAMERA', description: 'Select on the Camera' },
                        { value: 0x00000002, name: 'HOST', description: 'Select on the Remote/Host Device' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
        {
            name: 'TransferMode',
            description: 'The Initiator should send this command with one of the following values:',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
        {
            name: 'AdditionalInformation',
            description: 'The Initiator should send this command with one of the following values:',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'NONE', description: 'NONE' },
                        { value: 0x00000001, name: 'CANCEL', description: 'CANCEL' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const sonyOperationRegistry = {
    SDIO_OpenSession,
    SDIO_Connect,
    SDIO_GetExtDeviceInfo,
    SDIO_GetExtDevicePropValue,
    SDIO_SetExtDevicePropValue,
    SDIO_ControlDevice,
    SDIO_GetAllExtDevicePropInfo,
    SDIO_GetOsdImage,
    SDIO_GetPartialLargeObject,
    SDIO_SetContentsTransferMode,
} as const satisfies { [key: string]: OperationDefinition }

export type SonyOperationDef = (typeof sonyOperationRegistry)[keyof typeof sonyOperationRegistry]
