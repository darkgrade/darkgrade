import { baseCodecs } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'

export const genericEventRegistry = {
    Undefined: { code: 0x4000, name: 'Undefined', description: 'Undefined event', parameters: [] },
    CancelTransaction: { code: 0x4001, name: 'CancelTransaction', description: 'Cancel a transaction', parameters: [] },
    ObjectAdded: {
        code: 0x4002,
        name: 'ObjectAdded',
        description: 'New data object added to device',
        parameters: [{ name: 'ObjectHandle', description: 'Handle of the new object', codec: baseCodecs.uint32 }],
    },
    ObjectRemoved: {
        code: 0x4003,
        name: 'ObjectRemoved',
        description: 'Data object removed from device',
        parameters: [{ name: 'ObjectHandle', description: 'Handle of the removed object', codec: baseCodecs.uint32 }],
    },
    StoreAdded: {
        code: 0x4004,
        name: 'StoreAdded',
        description: 'New store added to device',
        parameters: [{ name: 'StorageID', description: 'ID of the new store', codec: baseCodecs.uint32 }],
    },
    StoreRemoved: {
        code: 0x4005,
        name: 'StoreRemoved',
        description: 'Store removed from device',
        parameters: [{ name: 'StorageID', description: 'ID of the removed store', codec: baseCodecs.uint32 }],
    },
    DevicePropChanged: {
        code: 0x4006,
        name: 'DevicePropChanged',
        description: 'Device property value changed',
        parameters: [{ name: 'DevicePropCode', description: 'Property that changed', codec: baseCodecs.uint16 }],
    },
    ObjectInfoChanged: {
        code: 0x4007,
        name: 'ObjectInfoChanged',
        description: 'Object information changed',
        parameters: [{ name: 'ObjectHandle', description: 'Handle of the object', codec: baseCodecs.uint32 }],
    },
    DeviceInfoChanged: {
        code: 0x4008,
        name: 'DeviceInfoChanged',
        description: 'Device information or capabilities changed',
        parameters: [],
    },
    RequestObjectTransfer: {
        code: 0x4009,
        name: 'RequestObjectTransfer',
        description: 'Responder requests object transfer',
        parameters: [{ name: 'ObjectHandle', description: 'Handle of the requested object', codec: baseCodecs.uint32 }],
    },
    StoreFull: {
        code: 0x400a,
        name: 'StoreFull',
        description: 'Store is full',
        parameters: [{ name: 'StorageID', description: 'ID of the full store', codec: baseCodecs.uint32 }],
    },
    DeviceReset: { code: 0x400b, name: 'DeviceReset', description: 'Device has been reset', parameters: [] },
    StorageInfoChanged: {
        code: 0x400c,
        name: 'StorageInfoChanged',
        description: 'Storage information changed',
        parameters: [{ name: 'StorageID', description: 'ID of the changed store', codec: baseCodecs.uint32 }],
    },
    CaptureComplete: {
        code: 0x400d,
        name: 'CaptureComplete',
        description: 'Capture operation completed',
        parameters: [],
    },
    UnreportedStatus: {
        code: 0x400e,
        name: 'UnreportedStatus',
        description: 'Unreported status change occurred',
        parameters: [],
    },
} as const satisfies { [key: string]: EventDefinition }

export type GenericEventDef = (typeof genericEventRegistry)[keyof typeof genericEventRegistry]
