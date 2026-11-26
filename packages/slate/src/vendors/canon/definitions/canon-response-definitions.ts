import { ResponseDefinition } from '@ptp/types/response'

const response = <const Code extends number, const Name extends string>(code: Code, name: Name, description: string) =>
    ({ code, name, description }) as const satisfies ResponseDefinition

/**
 * libgphoto2 ptp.h PTP_RC_EOS_ObjectNotReady (0xa102): the requested object or viewfinder frame is
 * not ready yet; ask again. The same vendor-range number means something else on Sony and Nikon.
 */
export const ObjectNotReady = response(0xa102, 'ObjectNotReady', 'The requested object or live-view frame is not ready yet; read it again shortly.')

export const canonResponseRegistry = {
    ObjectNotReady,
} as const
