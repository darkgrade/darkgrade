import { OperationDefinition } from '@ptp/types/operation'
import { baseCodecs } from '@ptp/types/codec'

export const nikonOperationDefinitions = [
    {
        code: 0x943b,
        name: 'GetDevicePropValueEx',
        description: 'Get device property value (4-byte extension)',
        dataDirection: 'out',
        operationParameters: [
            {
                name: 'DevicePropCode',
                description: 'Property code to get (4-byte extension)',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
    {
        code: 0x943c,
        name: 'SetDevicePropValueEx',
        description: 'Set device property value (4-byte extension)',
        dataDirection: 'in',
        operationParameters: [
            {
                name: 'DevicePropCode',
                description: 'Property code to set (4-byte extension)',
                codec: baseCodecs.uint32,
                required: true,
            },
        ],
        responseParameters: [],
    },
] as const satisfies readonly OperationDefinition[]

export function getOperationByName(name: string): OperationDefinition | undefined {
    return nikonOperationDefinitions.find(op => op.name === name)
}
