import { baseCodecs } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

/*
 * Olympus vendor operations named in libgphoto2 (camlibs/ptp2 at 02d92fe):
 * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h
 * Parameter counts and data directions follow the ptp.c functions and ptp.h macros cited per
 * definition. None is hardware-verified in darkgrade.
 */

/** ptp.h#L867 and macro ptp_olympus_capture (ptp.h#L5236) */
export const OlympusCapture = {
    code: 0x9101,
    name: 'OlympusCapture',
    description: 'E-series capture control; libgphoto2 sends 3 to start and 0 to end. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Stage', description: '3 start, 0 end (libgphoto2)', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L873 and macro ptp_olympus_setcameracontrolmode (ptp.h#L5234) */
export const OlympusSetCameraControlMode = {
    code: 0x910b,
    name: 'OlympusSetCameraControlMode',
    description: 'Selects the E-series camera control mode. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Mode', description: 'Control mode', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L875; ptp.c ptp_olympus_getdeviceinfo (PTP_DP_GETDATA) */
export const OlympusGetDeviceInfo = {
    code: 0x9301,
    name: 'OlympusGetDeviceInfo',
    description: 'E-series XML-wrapped DeviceInfo; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L876; ptp.c ptp_olympus_opensession (PTP_DP_GETDATA) */
export const OlympusOpenSession = {
    code: 0x9302,
    name: 'OlympusOpenSession',
    description: 'E-series vendor session open; answers with a data phase, returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L816; ptp.c ptp_olympus_omd_capture */
export const OlympusOmdCapture = {
    code: 0x9481,
    name: 'OlympusOmdCapture',
    description: 'OM-D capture control; libgphoto2 sends 3 to press and 6 to release. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Stage', description: '3 press, 6 release (libgphoto2)', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L819; ptp.c ptp_olympus_liveview_image (PTP_DP_GETDATA) */
export const OlympusGetLiveViewImage = {
    code: 0x9484,
    name: 'OlympusGetLiveViewImage',
    description: 'Gets one OM-D live-view frame; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'Parameter',
            description: 'Frame request parameter (libgphoto2 passes it through)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L822 and macro ptp_olympus_omd_move_focus (ptp.h#L5449) */
export const OlympusOmdMfDrive = {
    code: 0x9487,
    name: 'OlympusOmdMfDrive',
    description: 'Drives manual focus by direction and step size. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Direction', description: 'Focus direction', codec: baseCodecs.uint32, required: true },
        { name: 'StepSize', description: 'Step size', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const olympusOperationRegistry = {
    OlympusCapture,
    OlympusSetCameraControlMode,
    OlympusGetDeviceInfo,
    OlympusOpenSession,
    OlympusOmdCapture,
    OlympusGetLiveViewImage,
    OlympusOmdMfDrive,
} as const satisfies { [key: string]: OperationDefinition }
