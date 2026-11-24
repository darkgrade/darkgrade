import { baseCodecs } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

/*
 * Sigma vendor operations named in libgphoto2 (camlibs/ptp2 at 02d92fe):
 * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h
 * Parameter counts and data directions follow the ptp.c functions and ptp.h macros cited per
 * definition. None is hardware-verified in darkgrade.
 */

/** ptp.h#L1076; ptp.c ptp_sigma_fp_getdatagroup1 (PTP_DP_GETDATA) */
export const SigmaGetDataGroup1 = {
    code: 0x9012,
    name: 'SigmaGetDataGroup1',
    description: 'Reads Sigma fp settings data group 1; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1079; ptp.c ptp_sigma_fp_getcapturestatus (PTP_DP_GETDATA) */
export const SigmaGetCaptureStatus = {
    code: 0x9015,
    name: 'SigmaGetCaptureStatus',
    description: 'Reads the capture status for an image id; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [
        { name: 'ImageId', description: 'Capture identifier', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1080; ptp.c ptp_sigma_fp_setdatagroup1 (PTP_DP_SENDDATA) */
export const SigmaSetDataGroup1 = {
    code: 0x9016,
    name: 'SigmaSetDataGroup1',
    description: 'Writes Sigma fp settings data group 1 (checksummed block). Not hardware-verified.',
    dataDirection: 'in',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1084; ptp.c ptp_sigma_fp_snap (PTP_DP_SENDDATA) */
export const SigmaSnap = {
    code: 0x901b,
    name: 'SigmaSnap',
    description: 'Releases the shutter (data: count 2, mode, amount, checksum). Not hardware-verified.',
    dataDirection: 'in',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L1098; ptp.c ptp_sigma_fp_liveview_image (PTP_DP_GETDATA) */
export const SigmaGetCamViewFrame = {
    code: 0x902b,
    name: 'SigmaGetCamViewFrame',
    description: 'Gets one live-view frame; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const sigmaOperationRegistry = {
    SigmaGetDataGroup1,
    SigmaGetCaptureStatus,
    SigmaSetDataGroup1,
    SigmaSnap,
    SigmaGetCamViewFrame,
} as const satisfies { [key: string]: OperationDefinition }
