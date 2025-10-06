import { OperationDefinition } from '@ptp/types/operation'
import { EnumCodec, baseCodecs } from '@ptp/types/codec'
import { sdiExtDevicePropInfoCodec } from '@ptp/datasets/vendors/sony/sdi-ext-device-prop-info-dataset'

export const sonyOperationDefinitions = [
    {
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
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'REMOTE', description: 'Remote Control Mode' },
                        { value: 0x00000001, name: 'CONTENT_TRANSFER', description: 'Content Transfer Mode' },
                        {
                            value: 0x00000002,
                            name: 'REMOTE_AND_CONTENT_TRANSFER',
                            description: 'Remote Control with Transfer Mode',
                        },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
        code: 0x9201,
        name: 'SDIO_Connect',
        description: 'This is for the Sony SDIO authentication handshake.',
        dataDirection: 'out',
        dataCodec: baseCodecs.uint64,
        operationParameters: [
            {
                name: 'phaseType',
                description: 'Connection phase (1, 2, or 3)',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'keyCode1',
                description: 'KeyCode1 (always 0x00000000)',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'keyCode2',
                description: 'KeyCode2 (always 0x00000000)',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
        code: 0x9202,
        name: 'SDIO_GetExtDeviceInfo',
        description: 'Get the protocol version and the supported properties of the connected device.',
        dataDirection: 'out',
        operationParameters: [
            {
                name: 'initiatorVersion',
                description: 'Initiator Version',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'flagOfDevicePropertyOption',
                description: 'Enables extended SDIO Device Property / SDIControlCode',
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
        code: 0x9251,
        name: 'SDIO_GetExtDevicePropValue',
        description: 'Get the DevicePropInfo.',
        dataDirection: 'out',
        dataCodec: sdiExtDevicePropInfoCodec,
        operationParameters: [
            {
                name: 'devicePropCode',
                description: 'Property code to get',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
        code: 0x9205,
        name: 'SDIO_SetExtDevicePropValue',
        description: 'Set a DevicePropValue for a device property.',
        dataDirection: 'in',
        operationParameters: [
            {
                name: 'devicePropCode',
                description: 'Property code to set',
                codec: baseCodecs.uint32,
                required: true,
            },
            {
                name: 'flagOfDevicePropertyOption',
                description: 'Enables extended SDIO Device Property / SDIControlCode',
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
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
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
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
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
        code: 0x9238,
        name: 'SDIO_GetOsdImage',
        description: 'Get OSD image',
        dataDirection: 'out',
        operationParameters: [],
        responseParameters: [],
    },
    {
        code: 0x9211,
        name: 'SDIO_GetPartialLargeObject',
        description: 'Get partial object from the device. Same as GetPartialObject on PIMA 15740 but with 64-bit offset support.',
        dataDirection: 'out',
        dataCodec: baseCodecs.uint8array,
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
        ],
        responseParameters: [
            {
                name: 'ActualBytesSent',
                description: 'Actual number of bytes sent',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
    },
    {
        code: 0x9212,
        name: 'SDIO_SetContentsTransferMode',
        description: 'Enable content transfer mode to access memory card content.',
        dataDirection: 'none',
        operationParameters: [
            {
                name: 'ContentsSelectType',
                description: 'The Initiator should send this command with one of the following values:',
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'INVALID', description: 'INVALID' },
                        { value: 0x00000001, name: 'CAMERA', description: 'Select on the Camera' },
                        { value: 0x00000002, name: 'HOST', description: 'Select on the Remote/Host Device' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
            {
                name: 'TransferMode',
                description: 'The Initiator should send this command with one of the following values:',
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
                        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
            {
                name: 'AdditionalInformation',
                description: 'The Initiator should send this command with one of the following values:',
                codec: new EnumCodec(
                    [
                        { value: 0x00000000, name: 'NONE', description: 'NONE' },
                        { value: 0x00000001, name: 'CANCEL', description: 'CANCEL' },
                    ],
                    baseCodecs.uint32
                ),
                required: true,
            },
        ],
        responseParameters: [],
    },
] as const satisfies readonly OperationDefinition[]
