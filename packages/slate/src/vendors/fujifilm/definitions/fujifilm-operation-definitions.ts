import { OperationDefinition } from '@ptp/types/operation'
import { vendorOperation } from '@vendors/generic/vendor-operation'

/* Cited from https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h */

/** ptp.h#L1063; ptp.c ptp_fuji_getdeviceinfo (PTP_DP_GETDATA, no parameters) */
export const FujiGetDeviceInfo = vendorOperation(0x902b, 'FujiGetDeviceInfo', 'out', [],
    'Fujifilm vendor device-information list; returned undecoded. Not hardware-verified.')

export const fujifilmOperationRegistry = {
    FujiGetDeviceInfo,
} as const satisfies { [key: string]: OperationDefinition }
