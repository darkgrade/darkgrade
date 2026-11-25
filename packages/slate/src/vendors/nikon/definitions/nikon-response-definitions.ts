import { ResponseDefinition } from '@ptp/types/response'

const response = <const Code extends number, const Name extends string>(code: Code, name: Name, description: string) =>
    ({ code, name, description }) as const satisfies ResponseDefinition

/** Nikon USB/MTP response; the same vendor-range number means something else on Canon. */
export const HardwareError = response(0xa001, 'HardwareError', 'The camera reports a hardware error; inspect WarningStatus before recovery.')
export const InvalidStatus = response(0xa004, 'InvalidStatus', 'The operation cannot be performed due to the current camera status or an internal error.')
export const NotLiveView = response(0xa00b, 'NotLiveView', 'The camera is not in live view mode.')

/** libgphoto2 PTP_RC_NIKON_Silent_Release_Busy: a still exposure is processing. */
export const SilentReleaseBusy = response(0xa201, 'SilentReleaseBusy', 'Silent still-image capture is still processing; wait before restoring settings.')
export const ChangeCameraModeFailed = response(0xa003, 'ChangeCameraModeFailed', 'Indicates that the switching between the PC camera mode and the remote mode failed.')
export const OutOfFocus = response(0xa002, 'OutOfFocus', 'Autofocus completed without acquiring focus.')
export const MfDriveStepEnd = response(0xa00c, 'MfDriveStepEnd', 'Manual focus reached the lens travel limit.')
export const MfDriveStepInsufficiency = response(0xa00e, 'MfDriveStepInsufficiency', 'The requested manual-focus step was too small.')

export const nikonResponseRegistry = {
    HardwareError,
    SilentReleaseBusy,
    OutOfFocus,
    MfDriveStepEnd,
    MfDriveStepInsufficiency,
    InvalidStatus,
    NotLiveView,
    ChangeCameraModeFailed,
} as const
