import { baseCodecs } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

/*
 * Leica vendor operations named in libgphoto2 (camlibs/ptp2 at 02d92fe):
 * https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h
 * Parameter counts and data directions follow the ptp.c functions and ptp.h macros cited per
 * definition. None is hardware-verified in darkgrade.
 */

/** ptp.h#L905 and macro ptp_leica_leopensession (ptp.h#L5461) */
export const LeicaLEOpenSession = {
    code: 0x9005,
    name: 'LeicaLEOpenSession',
    description: 'Opens the Leica extended session used for remote control. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'SessionID', description: 'Session identifier', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L906 and macro ptp_leica_leclosesession (ptp.h#L5462) */
export const LeicaLECloseSession = {
    code: 0x9006,
    name: 'LeicaLECloseSession',
    description: 'Closes the Leica extended session. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const leicaOperationRegistry = {
    LeicaLEOpenSession,
    LeicaLECloseSession,
} as const satisfies { [key: string]: OperationDefinition }
