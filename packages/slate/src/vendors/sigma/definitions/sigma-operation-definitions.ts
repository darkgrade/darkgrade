import { OperationDefinition } from '@ptp/types/operation'
import { uint32Parameter, vendorOperation } from '@vendors/generic/vendor-operation'

/* Cited from https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h */

/** ptp.h#L1076; ptp.c ptp_sigma_fp_getdatagroup1 (PTP_DP_GETDATA) */
export const SigmaGetDataGroup1 = vendorOperation(0x9012, 'SigmaGetDataGroup1', 'out', [],
    'Reads Sigma fp settings data group 1; returned undecoded. Not hardware-verified.')
/** ptp.h#L1079; ptp.c ptp_sigma_fp_getcapturestatus (PTP_DP_GETDATA) */
export const SigmaGetCaptureStatus = vendorOperation(0x9015, 'SigmaGetCaptureStatus', 'out',
    [uint32Parameter('ImageId', 'Capture identifier', true)],
    'Reads the capture status for an image id; returned undecoded. Not hardware-verified.')
/** ptp.h#L1080; ptp.c ptp_sigma_fp_setdatagroup1 (PTP_DP_SENDDATA) */
export const SigmaSetDataGroup1 = vendorOperation(0x9016, 'SigmaSetDataGroup1', 'in', [],
    'Writes Sigma fp settings data group 1 (checksummed block). Not hardware-verified.')
/** ptp.h#L1084; ptp.c ptp_sigma_fp_snap (PTP_DP_SENDDATA) */
export const SigmaSnap = vendorOperation(0x901b, 'SigmaSnap', 'in', [],
    'Releases the shutter (data: count 2, mode, amount, checksum). Not hardware-verified.')
/** ptp.h#L1098; ptp.c ptp_sigma_fp_liveview_image (PTP_DP_GETDATA) */
export const SigmaGetCamViewFrame = vendorOperation(0x902b, 'SigmaGetCamViewFrame', 'out', [],
    'Gets one live-view frame; returned undecoded. Not hardware-verified.')

export const sigmaOperationRegistry = {
    SigmaGetDataGroup1,
    SigmaGetCaptureStatus,
    SigmaSetDataGroup1,
    SigmaSnap,
    SigmaGetCamViewFrame,
} as const satisfies { [key: string]: OperationDefinition }
