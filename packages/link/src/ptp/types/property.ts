import { CodecDefinition } from '@ptp/types/codec'

export type PropertyAccess = 'Get' | 'GetSet'

export interface PropertyDefinition<T = number | bigint | string> {
    code: number
    name: string
    description: string
    datatype: number
    access: PropertyAccess
    codec: CodecDefinition<T>
    defaultValue?: T
    currentValue?: T
}

export type DevicePropCode = number
