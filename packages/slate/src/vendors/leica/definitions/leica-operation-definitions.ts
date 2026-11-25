import { OperationDefinition } from '@ptp/types/operation'
import { uint32Parameter, vendorOperation } from '@vendors/generic/vendor-operation'

/* Cited from https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h */

/** ptp.h#L905 and macro ptp_leica_leopensession (ptp.h#L5461) */
export const LeicaLEOpenSession = vendorOperation(0x9005, 'LeicaLEOpenSession', 'none',
    [uint32Parameter('SessionID', 'Session identifier', true)],
    'Opens the Leica extended session used for remote control. Not hardware-verified.')
/** ptp.h#L906 and macro ptp_leica_leclosesession (ptp.h#L5462) */
export const LeicaLECloseSession = vendorOperation(0x9006, 'LeicaLECloseSession', 'none', [],
    'Closes the Leica extended session. Not hardware-verified.')

export const leicaOperationRegistry = {
    LeicaLEOpenSession,
    LeicaLECloseSession,
} as const satisfies { [key: string]: OperationDefinition }
