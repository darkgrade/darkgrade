import { ResponseDefinition } from '@ptp/types/response'

export const InvalidStatus = {
    code: 0xa004,
    name: 'InvalidStatus',
    description: 'The operation cannot be performed due to the current camera status or an internal error.',
} as const satisfies ResponseDefinition

export const NotLiveView = {
    code: 0xa00b,
    name: 'NotLiveView',
    description: 'The camera is not in live view mode.',
} as const satisfies ResponseDefinition

export const ChangeCameraModeFailed = {
    code: 0xa003,
    name: 'ChangeCameraModeFailed',
    description: 'Indicates that the switching between the PC camera mode and the remote mode failed.',
} as const satisfies ResponseDefinition

export const OutOfFocus = {
    code: 0xa002,
    name: 'OutOfFocus',
    description: 'Autofocus completed without acquiring focus.',
} as const satisfies ResponseDefinition

export const MfDriveStepEnd = {
    code: 0xa00c,
    name: 'MfDriveStepEnd',
    description: 'Manual focus reached the lens travel limit.',
} as const satisfies ResponseDefinition

export const MfDriveStepInsufficiency = {
    code: 0xa00e,
    name: 'MfDriveStepInsufficiency',
    description: 'The requested manual-focus step was too small.',
} as const satisfies ResponseDefinition

export const nikonResponseRegistry = {
    OutOfFocus,
    MfDriveStepEnd,
    MfDriveStepInsufficiency,
    InvalidStatus,
    NotLiveView,
    ChangeCameraModeFailed,
} as const

export type NikonResponseDef = (typeof nikonResponseRegistry)[keyof typeof nikonResponseRegistry]
