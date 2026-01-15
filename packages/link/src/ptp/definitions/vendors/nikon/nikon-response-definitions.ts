import { ResponseDefinition } from '@ptp/types/response'

export const InvalidStatus = {
    code: 0xa004,
    name: 'InvalidStatus',
    description: 'The operation cannot be performed due to the current camera status or an internal error.',
} as const satisfies ResponseDefinition

export const NotLiveView = {
    code: 0xa00e,
    name: 'NotLiveView',
    description: 'The camera is not in live view mode.',
} as const satisfies ResponseDefinition

export const ChangeCameraModeFailed = {
    code: 0xa003,
    name: 'ChangeCameraModeFailed',
    description: 'Indicates that the switching between the PC camera mode and the remote mode failed.',
} as const satisfies ResponseDefinition

export const nikonResponseRegistry = {
    InvalidStatus,
    NotLiveView,
    ChangeCameraModeFailed,
} as const

export type NikonResponseDef = (typeof nikonResponseRegistry)[keyof typeof nikonResponseRegistry]
