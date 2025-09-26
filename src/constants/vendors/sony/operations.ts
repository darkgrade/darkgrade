import { DataType, OperationDefinitions } from '@constants/types'
import { PTPOperations } from '@constants/ptp/operations'

export const SonyOperations = {
    ...PTPOperations,

    SDIO_OPEN_SESSION: {
        code: 0x9210,
        name: 'SDIO_OPEN_SESSION',
        description: 'Open Session with Function Mode.',

        parameters: [
            {
                name: 'SessionID',
                type: DataType.UINT32,
                description: 'Unique session identifier',
            },
            {
                name: 'Function Mode',
                type: DataType.UINT32,
                description: 'Function mode',
            },
        ],
    },

    SDIO_CONNECT: {
        code: 0x9201,
        name: 'SDIO_CONNECT',
        description: 'This is for the Sony SDIO authentication handshake.',
        parameters: [
            {
                name: 'Phase Type',
                type: DataType.UINT32,
                description: 'Connection phase (1, 2, or 3)',
                possibleValues: [
                    {
                        name: 'Phase 1',
                        description: 'Phase 1',
                        value: 1,
                    },
                    {
                        name: 'Phase 2',
                        description: 'Phase 2',
                        value: 2,
                    },
                    {
                        name: 'Phase 3',
                        description: 'Phase 3',
                        value: 3,
                    },
                ],
            },
            {
                name: 'KeyCode1',
                type: DataType.UINT32,
                description: 'KeyCode1 (always 0x00000000)',
                possibleValues: [
                    {
                        name: 'Default',
                        description: 'Standard KeyCode1 value',
                        value: 0x00000000,
                    },
                ],
            },
            {
                name: 'KeyCode2',
                type: DataType.UINT32,
                description: 'KeyCode2 (always 0x00000000)',
                possibleValues: [
                    {
                        name: 'Default',
                        description: 'Standard KeyCode2 value',
                        value: 0x00000000,
                    },
                ],
            },
        ],
        respondsWithData: true,
        dataDescription: 'UINT64 Value',
    },

    SDIO_GET_EXT_DEVICE_INFO: {
        code: 0x9202,
        name: 'SDIO_GET_EXT_DEVICE_INFO',
        description: 'Get the protocol version and the supported properties of the connected device.',
        parameters: [
            {
                name: 'Initiator Version',
                type: DataType.UINT32,
                description: 'Initiator Version',
            },
            {
                name: 'Flag of Device Property Option',
                type: DataType.UINT32,
                description: 'Flag of Device Property Option',
            },
        ],
        respondsWithData: true,
        dataDescription: 'SDIExtDeviceInfo Dataset',
    },

    SDIO_GET_EXT_DEVICE_PROP_VALUE: {
        code: 0x9251,
        name: 'SDIO_GET_EXT_DEVICE_PROP_VALUE',
        description: 'Get the DevicePropInfo.',
        parameters: [
            {
                name: 'DevicePropCode',
                type: DataType.UINT16,
                description: 'Property code to get',
            },
        ],
        respondsWithData: true,
        dataDescription: 'SDIDevicePropInfo Dataset',
    },

    SDIO_SET_EXT_DEVICE_PROP_VALUE: {
        code: 0x9205,
        name: 'SDIO_SET_EXT_DEVICE_PROP_VALUE',
        description: 'Set a DevicePropValue for a device property.',
        parameters: [
            {
                name: 'DevicePropCode',
                type: DataType.UINT16,
                description: 'Property code to set',
            },
            {
                name: 'Flag of Device Property Option',
                type: DataType.UINT16,
                description: '0x00000001: Enables extended SDIO Device Property / SDIControlCode',
            },
        ],
        expectsData: true,
        dataDescription: 'DevicePropValue',
    },

    SDIO_CONTROL_DEVICE: {
        code: 0x9207,
        name: 'SDIO_CONTROL_DEVICE',
        description: 'Set the SDIControl value for the SDIControlCode.',
        parameters: [
            {
                name: 'SDIControlCode',
                type: DataType.UINT16,
                description: 'Control property code',
            },
            {
                name: 'Flag of Device Property Option',
                type: DataType.UINT16,
                description: '0x00000001: Enables extended SDIO Device Property / SDIControlCode',
            },
        ],
        expectsData: true,
        dataDescription: 'SDIControl Value',
    },

    GET_ALL_EXT_DEVICE_PROP_INFO: {
        code: 0x9209,
        name: 'GET_ALL_EXT_DEVICE_PROP_INFO',
        description:
            'Obtain all support DevicePropDescs at one time. The host will send this operation at regular intervals to obtain the latest (current) camera settings.',
        parameters: [
            {
                name: 'Flag of get only difference data',
                type: DataType.UINT32,
                description: 'Flag of get only difference data',
            },
            {
                name: 'Flag of Device Property Option',
                type: DataType.UINT32,
                description: 'Flag of Device Property Option',
            },
        ],
        respondsWithData: true,
        dataDescription: 'SDIDevicePropInfo Dataset Array',
    },

    SDIO_GET_OSD_IMAGE: {
        code: 0x9238,
        name: 'SDIO_GET_OSD_IMAGE',
        description: 'Get OSD image',
        respondsWithData: true,
        dataDescription: 'OSD Image Dataset',
    },

    SDIO_SET_CONTENTS_TRANSFER_MODE: {
        code: 0x9212,
        name: 'SDIO_SET_CONTENTS_TRANSFER_MODE',
        description: 'Enable content transfer mode to access memory card content.',
        parameters: [
            {
                name: 'Transfer Mode',
                type: DataType.UINT32,
                description: 'Transfer mode setting (1 = enable content transfer)',
            },
        ],
    },
} as const satisfies OperationDefinitions

export type SonyOperationDefinitions = typeof SonyOperations
