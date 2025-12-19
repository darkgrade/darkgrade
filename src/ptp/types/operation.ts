import { CodecDefinition } from '@ptp/types/codec'
import { ParameterDefinition } from '@ptp/types/parameter'

export type DataDirection = 'none' | 'in' | 'out'

export interface OperationDefinition<T = number | bigint | string | object | Uint8Array | number[]> {
    code: number
    name: string
    description: string
    dataDirection: DataDirection
    dataCodec?: CodecDefinition<T>
    operationParameters: [
        ParameterDefinition?,
        ParameterDefinition?,
        ParameterDefinition?,
        ParameterDefinition?,
        ParameterDefinition?,
    ]
    responseParameters: [
        ParameterDefinition?,
        ParameterDefinition?,
        ParameterDefinition?,
        ParameterDefinition?,
        ParameterDefinition?,
    ]
}

export type OperationCode = number
