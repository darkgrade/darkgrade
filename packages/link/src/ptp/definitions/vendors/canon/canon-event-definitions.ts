import { EventDefinition } from '@ptp/types/event'

export const CanonValueChanged = {
    code: 0xc189,
    name: 'CanonValueChanged',
    description: 'Canon property value changed event',
    parameters: [
        {
            name: 'PropertyCode',
            description: 'Property code that changed',
            codec: registry => registry.codecs.uint16,
        },
        {
            name: 'Value',
            description: 'New property value',
            codec: registry => registry.codecs.uint16,
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
            codec: registry => registry.codecs.uint16,
        },
    ] as const,
} as const satisfies EventDefinition

export const canonEventRegistry = {
    CanonValueChanged,
    CanonAllowedValuesChanged,
} as const satisfies { [key: string]: EventDefinition }

export type CanonEventDef = (typeof canonEventRegistry)[keyof typeof canonEventRegistry]
