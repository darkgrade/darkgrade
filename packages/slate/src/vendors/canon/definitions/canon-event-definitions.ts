import { baseCodecs } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'

const uint32Parameter = (name: string, description: string) => ({ name, description, codec: baseCodecs.uint32 }) as const

const event = <const Code extends number, const Name extends string, const Parameters extends EventDefinition['parameters']>(
    code: Code,
    name: Name,
    description: string,
    parameters: Parameters
) => ({ code, name, description, parameters }) as const satisfies EventDefinition

/** An EOS GetEvent record announcing a new card object; every layout starts with its handle. */
const objectAdded = <const Code extends number, const Name extends string>(code: Code, name: Name, description: string) =>
    ({ code, name, description, parameters: [uint32Parameter('ObjectHandle', 'Handle of the new object')] as const }) as const satisfies EventDefinition

export const CanonValueChanged = event(0xc189, 'CanonValueChanged', 'Canon property value changed event', [
    uint32Parameter('PropertyCode', 'Property code that changed'),
    uint32Parameter('Value', 'New property value'),
])

export const CanonAllowedValuesChanged = event(0xc18a, 'CanonAllowedValuesChanged', 'Canon property allowed values changed event', [uint32Parameter('PropertyCode', 'Property code whose allowed values changed')])

/**
 * A new file on the card, as an EOS GetEvent record (libgphoto2 camlibs/ptp2/ptp.h,
 * PTP_EC_CANON_EOS_ObjectAddedEx 0xc181; the record starts with the new object's handle).
 */
export const CanonObjectAddedEx = objectAdded(0xc181, 'CanonObjectAddedEx', 'Canon EOS object added to the card')

/**
 * A new file on the card with a 64-bit size, as newer EOS bodies report it (libgphoto2
 * camlibs/ptp2/ptp.h, PTP_EC_CANON_EOS_ObjectAddedEx64 0xc1a7).
 */
export const CanonObjectAddedEx64 = objectAdded(0xc1a7, 'CanonObjectAddedEx64', 'Canon EOS object added to the card (64-bit size)')

/**
 * A new file on the card with a long file name, as the newest EOS bodies report it (libgphoto2
 * camlibs/ptp2/ptp.h, PTP_EC_CANON_EOS_ObjectAddedEx64LFN 0xc1b6). libgphoto2 decodes no layout
 * for it; like every EOS object record it starts with the object handle, and the name comes from
 * ObjectInfo.
 */
export const CanonObjectAddedEx64LFN = objectAdded(0xc1b6, 'CanonObjectAddedEx64LFN', 'Canon EOS object added to the card (long file name)')

export const canonEventRegistry = {
    CanonValueChanged,
    CanonAllowedValuesChanged,
    CanonObjectAddedEx,
    CanonObjectAddedEx64,
    CanonObjectAddedEx64LFN,
} as const satisfies { [key: string]: EventDefinition }

export type CanonEventDef = (typeof canonEventRegistry)[keyof typeof canonEventRegistry]
