import { EventDefinition } from '@ptp/types/event'

export const CanonValueChanged = {
    code: 0xc189,
    name: 'CanonValueChanged',
    description: 'Canon property value changed event',
    parameters: [
        {
            name: 'PropertyCode',
            description: 'Property code that changed',
            codec: registry => registry.codecs.uint32,
        },
        {
            name: 'Value',
            description: 'New property value',
            codec: registry => registry.codecs.uint32,
        },
    ] as const,
} as const satisfies EventDefinition

export const CanonAllowedValuesChanged = {
    code: 0xc18a,
    name: 'CanonAllowedValuesChanged',
    description: 'Canon property allowed values changed event',
    parameters: [
        {
            name: 'PropertyCode',
            description: 'Property code whose allowed values changed',
            codec: registry => registry.codecs.uint32,
        },
    ] as const,
} as const satisfies EventDefinition

/**
 * A new file on the card, as an EOS GetEvent record (libgphoto2 camlibs/ptp2/ptp.h,
 * PTP_EC_CANON_EOS_ObjectAddedEx 0xc181; the record starts with the new object's handle).
 */
export const CanonObjectAddedEx = {
    code: 0xc181,
    name: 'CanonObjectAddedEx',
    description: 'Canon EOS object added to the card',
    parameters: [
        {
            name: 'ObjectHandle',
            description: 'Handle of the new object',
            codec: registry => registry.codecs.uint32,
        },
    ] as const,
} as const satisfies EventDefinition

/**
 * A new file on the card with a 64-bit size, as newer EOS bodies report it (libgphoto2
 * camlibs/ptp2/ptp.h, PTP_EC_CANON_EOS_ObjectAddedEx64 0xc1a7).
 */
export const CanonObjectAddedEx64 = {
    code: 0xc1a7,
    name: 'CanonObjectAddedEx64',
    description: 'Canon EOS object added to the card (64-bit size)',
    parameters: [
        {
            name: 'ObjectHandle',
            description: 'Handle of the new object',
            codec: registry => registry.codecs.uint32,
        },
    ] as const,
} as const satisfies EventDefinition

export const canonEventRegistry = {
    CanonValueChanged,
    CanonAllowedValuesChanged,
    CanonObjectAddedEx,
    CanonObjectAddedEx64,
} as const satisfies { [key: string]: EventDefinition }

export type CanonEventDef = (typeof canonEventRegistry)[keyof typeof canonEventRegistry]
