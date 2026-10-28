import { OperationDefinition } from '@ptp/types/operation'

/*
 * Fujifilm vendor operations named in libgphoto2 (camlibs/ptp2 at 02d92fe):
 * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h
 * Parameter counts and data directions follow the ptp.c functions and ptp.h macros cited per
 * definition. None is hardware-verified in darkgrade.
 */

/** ptp.h#L1063; ptp.c ptp_fuji_getdeviceinfo (PTP_DP_GETDATA, no parameters) */
export const FujiGetDeviceInfo = {
    code: 0x902b,
    name: 'FujiGetDeviceInfo',
    description: 'Fujifilm vendor device-information list; returned undecoded. Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const fujifilmOperationRegistry = {
    FujiGetDeviceInfo,
} as const satisfies { [key: string]: OperationDefinition }
