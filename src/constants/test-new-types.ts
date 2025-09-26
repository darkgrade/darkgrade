import { DataType, RuntimeParameter, createRuntimeParameter } from './types'

// this is bad, boolean is not one of the allowed data types for UINT16
export const badExample1: RuntimeParameter = {
    name: 'param',
    type: DataType.UINT16,
    description: 'param',
    possibleValues: [
        {
            name: 'param',
            description: 'param',
            value: false,
        },
    ],
    value: false,
}

// this is bad, we defined the datatype as UINT16, but we're passing a string
export const badExample2: RuntimeParameter = {
    name: 'param',
    type: DataType.UINT16,
    description: 'param',
    possibleValues: [
        {
            name: 'param',
            description: 'param',
            value: 'my-string',
        },
    ],
    value: 'my-string',
}

// this is good, UINT16 expects number and we provide number
export const goodExample: RuntimeParameter = {
    name: 'param',
    type: DataType.UINT16,
    description: 'param',
    possibleValues: [
        {
            name: 'Valid Value',
            description: 'A valid UINT16 value',
            value: 12345,
        },
    ],
    value: 12345,
}

// this is good, UINT16 expects number and we provide number
export const goodExample2: RuntimeParameter = {
    name: 'param',
    type: DataType.ARRAY_UINT16,
    description: 'param',
    // possibleValues: [
    //     {
    //         name: 'Valid Value',
    //         description: 'A valid UINT16 value',
    //         value: 12345,
    //     },
    // ],
    value: [12345],
}
