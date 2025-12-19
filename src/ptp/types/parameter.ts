import { CodecDefinition } from '@ptp/types/codec'

export interface ParameterDefinition<T = number | bigint | string> {
    name: string
    description: string
    codec: CodecDefinition<T>
    required: boolean
    defaultValue?: T
}
