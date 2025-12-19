import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { NikonLiveViewDatasetCodec } from '@ptp/datasets/vendors/nikon/nikon-live-view-dataset'
import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { baseCodecs, EnumCodec } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'
import { PropertyDefinition } from '@ptp/types/property'

const UINT8 = getDatatypeByName('UINT8')!.code

// Nikon-specific properties
export const ISOAutoControl = {
    code: 0xd054,
    name: 'ISOAutoControl',
    description: 'ISO sensitivity settings – Auto ISO sensitivity control',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0, name: 'OFF', description: 'Auto ISO control disabled' },
                { value: 1, name: 'ON', description: 'Auto ISO control enabled' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const GetPartialObjectEx = {
    code: 0x9431,
    name: 'GetPartialObjectEx',
    description: 'Get partial object with 64-bit offset support (extension of GetPartialObject)',
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
            name: 'MaxSizeLower',
            description: 'Maximum bytes to return (lower 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'MaxSizeUpper',
            description: 'Maximum bytes to return (upper 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ],
    responseParameters: [
        {
            name: 'ActualBytesSentLower',
            description: 'Actual bytes sent (lower 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'ActualBytesSentUpper',
            description: 'Actual bytes sent (upper 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ],
} as const satisfies OperationDefinition

export const GetDevicePropDescEx = {
    code: 0x943a,
    name: 'GetDevicePropDescEx',
    description: 'Get device property descriptor (4-byte extension)',
    dataDirection: 'out',
    dataCodec: registry => new DevicePropDescCodec(registry, true),
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code to get descriptor for (4-byte extension)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ],
    responseParameters: [],
} as const satisfies OperationDefinition

export const GetDevicePropValueEx = {
    code: 0x943b,
    name: 'GetDevicePropValueEx',
    description: 'Get device property value (4-byte extension)',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code to get (4-byte extension)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ],
    responseParameters: [],
} as const satisfies OperationDefinition

export const SetDevicePropValueEx = {
    code: 0x943c,
    name: 'SetDevicePropValueEx',
    description: 'Set device property value (4-byte extension)',
    dataDirection: 'in',
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code to set (4-byte extension)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ],
    responseParameters: [],
} as const satisfies OperationDefinition

export const DeviceReady = {
    code: 0x90c8,
    name: 'DeviceReady',
    description: 'Check status of activation-type command (e.g. StartLiveView, AfDrive)',
    dataDirection: 'none',
    operationParameters: [],
    responseParameters: [],
} as const satisfies OperationDefinition

export const StartLiveView = {
    code: 0x9201,
    name: 'StartLiveView',
    description: 'Start remote live view mode (activation-type command)',
    dataDirection: 'none',
    operationParameters: [],
    responseParameters: [],
} as const satisfies OperationDefinition

export const EndLiveView = {
    code: 0x9202,
    name: 'EndLiveView',
    description: 'End remote live view mode',
    dataDirection: 'none',
    operationParameters: [],
    responseParameters: [],
} as const satisfies OperationDefinition

export const GetLiveViewImageEx = {
    code: 0x9428,
    name: 'GetLiveViewImageEx',
    description: 'Get live view image with metadata (LiveViewObject with version)',
    dataDirection: 'out',
    dataCodec: registry => new NikonLiveViewDatasetCodec(registry),
    operationParameters: [],
    responseParameters: [],
} as const satisfies OperationDefinition

export const nikonOperationRegistry = {
    GetPartialObjectEx,
    GetDevicePropDescEx,
    GetDevicePropValueEx,
    SetDevicePropValueEx,
    DeviceReady,
    StartLiveView,
    EndLiveView,
    GetLiveViewImageEx,
} as const satisfies { [key: string]: OperationDefinition }

export type NikonOperationDef = (typeof nikonOperationRegistry)[keyof typeof nikonOperationRegistry]
