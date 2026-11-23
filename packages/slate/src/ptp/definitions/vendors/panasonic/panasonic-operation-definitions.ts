import { baseCodecs } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

/*
 * Panasonic vendor operations named in libgphoto2 (camlibs/ptp2 at 02d92fe):
 * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h
 * Parameter counts and data directions follow the ptp.c functions and ptp.h macros cited per
 * definition. None is hardware-verified in darkgrade.
 */

/** ptp.h#L979; ptp.c ptp_panasonic_getdevicepropertydesc sends (propcode, 0, 0) and reads data */
export const PanasonicListProperty = {
    code: 0x9108,
    name: 'PanasonicListProperty',
    description: 'Lists the descriptor of a Panasonic property (or all); returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [
        { name: 'PropertyCode', description: 'Panasonic property code', codec: baseCodecs.uint32, required: true },
        { name: 'Reserved1', description: '0 (libgphoto2)', codec: baseCodecs.uint32, required: false },
        { name: 'Reserved2', description: '0 (libgphoto2)', codec: baseCodecs.uint32, required: false },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L985; ptp.c ptp_panasonic_getdeviceproperty (PTP_DP_GETDATA) */
export const PanasonicGetProperty = {
    code: 0x9402,
    name: 'PanasonicGetProperty',
    description: 'Reads a Panasonic property value block; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [
        { name: 'PropertyCode', description: 'Panasonic property code', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L986; ptp.c ptp_panasonic_setdeviceproperty (PTP_DP_SENDDATA) */
export const PanasonicSetProperty = {
    code: 0x9403,
    name: 'PanasonicSetProperty',
    description: 'Writes a Panasonic property value block (code, size, value). Not hardware-verified.',
    dataDirection: 'in',
    operationParameters: [
        { name: 'PropertyCode', description: 'Panasonic property code', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L987 and macro ptp_panasonic_capture (ptp.h#L5459) */
export const PanasonicInitiateCapture = {
    code: 0x9404,
    name: 'PanasonicInitiateCapture',
    description: 'Rec Ctrl Release; libgphoto2 sends 0x03000011 to capture. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'Action',
            description: 'Release action (0x03000011 capture)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L993; ptp.c ptp_panasonic_setcapturetarget (PTP_DP_SENDDATA) */
export const PanasonicSetCaptureTarget = {
    code: 0x940b,
    name: 'PanasonicSetCaptureTarget',
    description:
        'Selects card or RAM as capture target (data: 0x08000091, size 2, UINT16 mode). Not hardware-verified.',
    dataDirection: 'in',
    operationParameters: [
        { name: 'Reserved', description: '0 (libgphoto2)', codec: baseCodecs.uint32, required: false },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L994 and macro ptp_panasonic_movierec (ptp.h#L5392) */
export const PanasonicMovieRecControl = {
    code: 0x940c,
    name: 'PanasonicMovieRecControl',
    description: 'Starts (0x07000011) or stops (0x07000012) movie recording. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Action', description: '0x07000011 start, 0x07000012 stop', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1000 and macro ptp_panasonic_liveview (ptp.h#L5390) */
export const PanasonicLiveview = {
    code: 0x9412,
    name: 'PanasonicLiveview',
    description: 'Starts (0x0D000010) or stops (0x0D000011) live view. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Action', description: '0x0D000010 start, 0x0D000011 stop', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1002; ptp.c ptp_panasonic_9414_0d800012 / _0d800011 */
export const PanasonicGetLiveViewParameters = {
    code: 0x9414,
    name: 'PanasonicGetLiveViewParameters',
    description:
        'Reads live-view size parameters (0x0D800012 all, 0x0D800011 current); returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'Selector',
            description: '0x0D800012 all formats, 0x0D800011 current',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1003; ptp.c ptp_panasonic_9415 (PTP_DP_SENDDATA) */
export const PanasonicSetLiveViewParameters = {
    code: 0x9415,
    name: 'PanasonicSetLiveViewParameters',
    description:
        'Sets the current live-view size (data: 0x0D800011, 8, height, width, x, freq). Not hardware-verified.',
    dataDirection: 'in',
    operationParameters: [
        { name: 'Selector', description: '0x0D800011', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1014; ptp.c ptp_panasonic_liveview_image (PTP_DP_GETDATA) */
export const PanasonicLiveviewImage = {
    code: 0x9706,
    name: 'PanasonicLiveviewImage',
    description: 'Gets one live-view frame; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const panasonicOperationRegistry = {
    PanasonicListProperty,
    PanasonicGetProperty,
    PanasonicSetProperty,
    PanasonicInitiateCapture,
    PanasonicSetCaptureTarget,
    PanasonicMovieRecControl,
    PanasonicLiveview,
    PanasonicGetLiveViewParameters,
    PanasonicSetLiveViewParameters,
    PanasonicLiveviewImage,
} as const satisfies { [key: string]: OperationDefinition }
