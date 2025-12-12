import { createEnumCodec } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

export const CanonSetRemoteMode = {
    code: 0x9114,
    name: 'CanonSetRemoteMode',
    description: 'Set Remote Mode.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'RemoteMode',
            description: 'Remote mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000001, name: 'ENABLE', description: 'Enable Remote Mode' },
                        { value: 0x00000000, name: 'DISABLE', description: 'Disable Remote Mode' }
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonSetEventMode = {
    // listed in the R6 Mk.III supported operations
    code: 0x9114,
    name: 'CanonSetEventMode',
    description: 'Set Event Mode.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'EventMode',
            description: 'Event mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000001, name: 'ENABLE', description: 'Enable Event Mode' },
                        { value: 0x00000000, name: 'DISABLE', description: 'Disable Event Mode' }
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonRemoteReleaseOn = {
    code: 0x9128,
    name: 'CanonRemoteReleaseOn',
    description: 'Remote Release On.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'ReleaseMode',
            description: 'Release mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000001, name: 'FOCUS', description: 'Focus Release' },
                        { value: 0x00000002, name: 'SHUTTER', description: 'Shutter Release' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ],
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonRemoteReleaseOff = {
    code: 0x9129,
    name: 'CanonRemoteReleaseOff',
    description: 'Remote Release Off.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'ReleaseMode',
            description: 'Release mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000001, name: 'FOCUS', description: 'Focus Release' },
                        { value: 0x00000002, name: 'SHUTTER', description: 'Shutter Release' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ],
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const canonOperationRegistry = {
    CanonSetRemoteMode,
    CanonSetEventMode,
    CanonRemoteReleaseOn,
    CanonRemoteReleaseOff,
} as const satisfies { [key: string]: OperationDefinition }

export type CanonOperationDef = (typeof canonOperationRegistry)[keyof typeof canonOperationRegistry]
