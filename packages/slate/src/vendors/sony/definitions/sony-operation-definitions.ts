import {
    SDIDevicePropInfoArrayCodec,
    SDIExtDevicePropInfoCodec,
} from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import { SonyExtendedDeviceInfoCodec } from '@vendors/sony/datasets/sdi-ext-device-info-dataset'
import { baseCodecs } from '@ptp/types/codec'
import { sonyEnum } from '@vendors/sony/definitions/sony-enum-codec'
import { OperationDefinition } from '@ptp/types/operation'

/** A required uint32 operation parameter. */
const uint32 = <const Name extends string, const Description extends string>(name: Name, description: Description) =>
    ({ name, description, codec: baseCodecs.uint32, required: true }) as const

const disableEnable = () =>
    sonyEnum('uint32', [
        { value: 0x00000000, name: 'DISABLE', description: 'DISABLE' },
        { value: 0x00000001, name: 'ENABLE', description: 'ENABLE' },
    ])

const devicePropertyOption = <const Required extends boolean>(required: Required) =>
    ({
        name: 'flagOfDevicePropertyOption',
        description: 'Enables extended SDIO Device Property / SDIControlCode',
        codec: disableEnable(),
        required,
    }) as const

const defaultKeyCode = <const Name extends string, const Description extends string>(name: Name, description: Description) =>
    ({
        name,
        description,
        codec: sonyEnum('uint32', [{ value: 0x00000000, name: 'DEFAULT', description: 'Default key code' }]),
        required: true,
    }) as const

const transferModeDescription = 'The Initiator should send this command with one of the following values:'

export const SDIO_OpenSession = {
    code: 0x9210,
    name: 'SDIO_OpenSession',
    description: 'Open Session with Function Mode.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'SessionId', description: 'Unique session identifier', codec: baseCodecs.uint32, required: true },
        {
            name: 'FunctionMode',
            description: 'Function mode',
            codec: sonyEnum('uint32', [
                { value: 0x00000000, name: 'REMOTE', description: 'Remote Control Mode' },
                { value: 0x00000001, name: 'CONTENT_TRANSFER', description: 'Content Transfer Mode' },
                { value: 0x00000002, name: 'REMOTE_AND_CONTENT_TRANSFER', description: 'Remote Control with Transfer Mode' },
            ]),
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
            codec: sonyEnum('uint32', [
                { value: 0x01, name: 'PHASE_1', description: 'Authentication Phase 1' },
                { value: 0x02, name: 'PHASE_2', description: 'Authentication Phase 2' },
                { value: 0x03, name: 'PHASE_3', description: 'Authentication Phase 3' },
            ]),
            required: true,
        },
        defaultKeyCode('keyCode1', 'KeyCode1 (always 0x00000000)'),
        defaultKeyCode('keyCode2', 'KeyCode2 (always 0x00000000)'),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetExtDeviceInfo = {
    code: 0x9202,
    name: 'SDIO_GetExtDeviceInfo',
    description: 'Get the protocol version and the supported properties of the connected device.',
    dataDirection: 'out',
    dataCodec: registry => new SonyExtendedDeviceInfoCodec(registry),
    operationParameters: [
        {
            name: 'initiatorVersion',
            description: 'Initiator Protocol Version',
            codec: sonyEnum('uint32', [
                { value: 0x00c8, name: '2.00', description: 'Protocol Version 2.00 (ILCE-7M2 capture)' },
                { value: 0x012c, name: '3.00', description: 'Protocol Version 3.00' },
            ]),
            required: true,
        },
        devicePropertyOption(false),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetExtDevicePropValue = {
    code: 0x9251,
    name: 'SDIO_GetExtDevicePropValue',
    description: 'Get the DevicePropInfo.',
    dataDirection: 'out',
    dataCodec: registry => new SDIExtDevicePropInfoCodec(registry),
    operationParameters: [uint32('DevicePropCode', 'Property code to get')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_SetExtDevicePropValue = {
    code: 0x9205,
    name: 'SDIO_SetExtDevicePropValue',
    description: 'Set a DevicePropValue for a device property.',
    dataDirection: 'in',
    operationParameters: [uint32('DevicePropCode', 'Property code to set'), devicePropertyOption(false)] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_ControlDevice = {
    code: 0x9207,
    name: 'SDIO_ControlDevice',
    description: 'Set the SDIControl value for the SDIControlCode.',
    dataDirection: 'in',
    operationParameters: [uint32('sdiControlCode', 'Control property code'), devicePropertyOption(false)] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetControlDeviceDesc = {
    code: 0x9206,
    name: 'SDIO_GetControlDeviceDesc',
    description: 'Read the descriptor and accepted values for a Sony momentary control.',
    dataDirection: 'out',
    operationParameters: [uint32('sdiControlCode', 'Sony control code to describe')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetAllExtDevicePropInfo = {
    code: 0x9209,
    name: 'SDIO_GetAllExtDevicePropInfo',
    description:
        'Obtain all support DevicePropDescs at one time. The host will send this operation at regular intervals to obtain the latest (current) camera settings.',
    dataDirection: 'out',
    dataCodec: registry => new SDIDevicePropInfoArrayCodec(registry),
    operationParameters: [
        uint32('flagOfGetOnlyDifferenceData', 'Flag of get only difference data'),
        devicePropertyOption(true),
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
    // FX2 and a6700 return the standard GetPartialObject data-container code.
    dataOperationCode: 0x101b,
    name: 'SDIO_GetPartialLargeObject',
    description:
        'Get partial object from the device. Same as GetPartialObject on PIMA 15740 but with 64-bit offset support.',
    dataDirection: 'out',
    operationParameters: [
        uint32('ObjectHandle', 'Object handle'),
        uint32('OffsetLower', 'Offset in bytes (lower 32 bits)'),
        uint32('OffsetUpper', 'Offset in bytes (upper 32 bits)'),
        uint32('MaxBytes', 'Maximum number of bytes to obtain (does not support 0xFFFFFFFF)'),
    ] as const,
    responseParameters: [uint32('ActualBytesSent', 'Actual number of bytes sent')] as const,
} as const satisfies OperationDefinition

export const SDIO_SetContentsTransferMode = {
    code: 0x9212,
    name: 'SDIO_SetContentsTransferMode',
    description: 'Enable content transfer mode to access memory card content.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'ContentsSelectType',
            description: transferModeDescription,
            codec: sonyEnum('uint32', [
                { value: 0x00000000, name: 'INVALID', description: 'INVALID' },
                { value: 0x00000001, name: 'CAMERA', description: 'Select on the Camera' },
                { value: 0x00000002, name: 'HOST', description: 'Select on the Remote/Host Device' },
            ]),
            required: true,
        },
        { name: 'TransferMode', description: transferModeDescription, codec: disableEnable(), required: true },
        {
            name: 'AdditionalInformation',
            description: transferModeDescription,
            codec: sonyEnum('uint32', [
                { value: 0x00000000, name: 'NONE', description: 'NONE' },
                { value: 0x00000001, name: 'CANCEL', description: 'CANCEL' },
            ]),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetCapturedDateList = {
    code: 0x923b,
    name: 'SDIO_GetCapturedDateList',
    description: 'Get the capture dates of representative content on a slot (UINT64 local-time ms array).',
    dataDirection: 'out',
    operationParameters: [uint32('SlotNumber', '1 = SLOT1, 2 = SLOT2')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetContentInfoList = {
    code: 0x923c,
    name: 'SDIO_GetContentInfoList',
    description: 'Get the card content list from a creation time, in Remote Control with Transfer Mode.',
    dataDirection: 'out',
    operationParameters: [
        uint32('CreateTimeLower', 'Creation time in Unix ms, lower 32 bits'),
        uint32('CreateTimeUpper', 'Creation time in Unix ms, upper 32 bits'),
        uint32('ContentLimit', 'Maximum number of contents to return'),
        uint32('Extra1', 'Bits 7-0: slot number'),
        uint32('Extra2', 'Bits 1-0: time type (0 = UTC, 1 = local time)'),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SDIO_GetContentCompressedData = {
    code: 0x923e,
    name: 'SDIO_GetContentCompressedData',
    description: 'Get a content thumbnail (1) or screennail (2) as JPEG.',
    dataDirection: 'out',
    operationParameters: [
        uint32('ContentID', 'Content ID within the slot'),
        uint32('SlotAndFileID', 'Bits 31-24: slot number; bits 15-0: file ID'),
        uint32('Type', '1 = thumbnail, 2 = screennail'),
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
    SDIO_GetControlDeviceDesc,
    SDIO_GetAllExtDevicePropInfo,
    SDIO_GetOsdImage,
    SDIO_GetPartialLargeObject,
    SDIO_SetContentsTransferMode,
    SDIO_GetCapturedDateList,
    SDIO_GetContentInfoList,
    SDIO_GetContentCompressedData,
} as const satisfies { [key: string]: OperationDefinition }

export type SonyOperationDef = (typeof sonyOperationRegistry)[keyof typeof sonyOperationRegistry]
