import { baseCodecs } from '@ptp/types/codec'
import type { DataDirection } from '@ptp/types/operation'

/** A UINT32 command parameter, the only kind the cited libgphoto2 vendor operations send. */
export const uint32Parameter = <const Name extends string, const Required extends boolean>(
    name: Name,
    description: string,
    required: Required
) => ({ name, description, codec: baseCodecs.uint32, required }) as const

/**
 * A vendor operation named in libgphoto2 (camlibs/ptp2 at 02d92fe, ptp.h and ptp.c), with no
 * response parameters; a data phase is returned undecoded. None is hardware-verified in darkgrade.
 */
export const vendorOperation = <
    const Code extends number,
    const Name extends string,
    const Direction extends DataDirection,
    const Parameters extends ReturnType<typeof uint32Parameter>[],
>(
    code: Code,
    name: Name,
    dataDirection: Direction,
    operationParameters: Parameters,
    description: string
) => ({ code, name, description, dataDirection, operationParameters, responseParameters: [] as [] })
