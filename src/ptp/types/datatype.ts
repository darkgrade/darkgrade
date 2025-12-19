import { CodecDefinition } from '@ptp/types/codec'

export interface DatatypeDefinition<T = number | bigint | string | number[] | bigint[] | string[]> {
    code: number
    name: string
    description: string
    codec: CodecDefinition<T>
}

export type DatatypeCode = number
