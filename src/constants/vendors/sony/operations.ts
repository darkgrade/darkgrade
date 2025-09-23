import { DataType } from '@constants/types'
import { PTPOperations } from '@constants/ptp/operations'

export const SonyOperations = {
    ...PTPOperations,

    SDIO_CONNECT: {
        code: 0x9201,
        description: 'This is for the Sony SDIO authentication handshake.',
        parameters: [
            {
                name: 'Phase Type',
                type: DataType.UINT32,
                description: 'Connection phase (1, 2, or 3)',
            },
            {
                name: 'KeyCode1',
                type: DataType.UINT32,
                description: 'KeyCode1 (always 0x00000000)',
            },
            {
                name: 'KeyCode2',
                type: DataType.UINT32,
                description: 'KeyCode2 (always 0x00000000)',
            },
        ],
        respondsWithData: true,
        dataDescription: 'UINT64 Value',
    },

    SDIO_GET_EXT_DEVICE_INFO: {
        code: 0x9202,
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
        description: 'Get OSD image',
        respondsWithData: true,
        dataDescription: 'OSD Image Dataset',
    },
} as const

export type SonyOperationDefinitions = typeof SonyOperations
