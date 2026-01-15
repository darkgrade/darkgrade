import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { baseCodecs, createEnumCodec, PTPRegistry } from '@ptp/types/codec'
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
                        { value: 0x00000000, name: 'DISABLE', description: 'Disable Remote Mode' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonSetEventMode = {
    code: 0x9115,
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
                        { value: 0x00000000, name: 'DISABLE', description: 'Disable Event Mode' },
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
    description:
        'Remote Release On. First parameter: 1=half press, 2=full press, 3=half+full press. Second parameter: 0=AF enabled, 1=AF disabled (MF).',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'ReleaseMode',
            description: 'Release mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000001, name: 'FOCUS', description: 'Half Press (Focus)' },
                        { value: 0x00000002, name: 'SHUTTER', description: 'Full Press (Shutter)' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
        {
            name: 'AFMode',
            description: 'Autofocus mode: 0=AF enabled, 1=AF disabled (Manual Focus)',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000000, name: 'AF', description: 'Autofocus Enabled' },
                        { value: 0x00000001, name: 'MF', description: 'Manual Focus' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonRemoteReleaseOff = {
    code: 0x9129,
    name: 'CanonRemoteReleaseOff',
    description: 'Remote Release Off. Parameter: 1=release half, 2=release full, 3=release all.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'ReleaseMode',
            description: 'Release mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0x00000001, name: 'FOCUS', description: 'Release Half Press' },
                        { value: 0x00000002, name: 'SHUTTER', description: 'Release Full Press' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonSetDevicePropValue = {
    code: 0x9110,
    name: 'CanonSetPropValue',
    description: 'Set Property Value (Canon-specific).',
    dataDirection: 'in',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/**
 * This doesn't actually seem useful. Canon relies on events for all property updates/changes.
 *
 * The only operations Canon EOS utility uses this for are:
 * - 0xd1af (Serial Number)
 * - 0xd1a6 (Battery Info)
 * - 0xd169 (Error History)
 * - 0xd16a (Lens Exchange History) (?)
 * - 0xd16b (Strobo Exchange History) (?)
 * - 0xd272 (?)
 *
 * These do not match up with the devicePropertiesSupported returned by GetDeviceInfo:
 * - 0xd402 (Vanilla PTP, DeviceFriendlyName)
 * - 0xd407 (Vanilla PTP, PerceivedDeviceType)
 * - 0xd406 (Vanilla PTP, SessionInitiatorInfo)
 * - 0x5001 (Vanilla PTP, BatteryLevel)
 * - 0xd303 (?)
 */
export const CanonRequestDevicePropValue = {
    code: 0x9127,
    name: 'CanonRequestDevicePropValue',
    description:
        'Request Property Value (Canon-specific). This operation requests the camera to send a property value via an event, it does not return the value directly.',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonGetEventData = {
    code: 0x9116,
    name: 'CanonGetEventData',
    description: 'Get Event Data (Canon-specific event polling).',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
    dataCodec: (registry: PTPRegistry) => new CanonEventDataCodec(registry),
} as const satisfies OperationDefinition

// not working
// export const CanonMovieSelectSWOn = {
//     code: 0x9133,
//     name: 'CanonMovieSelectSWOn',
//     description: 'Start movie recording.',
//     dataDirection: 'none',
//     operationParameters: [] as const,
//     responseParameters: [] as const,
// } as const satisfies OperationDefinition

// export const CanonMovieSelectSWOff = {
//     code: 0x9134,
//     name: 'CanonMovieSelectSWOff',
//     description: 'Stop movie recording.',
//     dataDirection: 'none',
//     operationParameters: [] as const,
//     responseParameters: [] as const,
// } as const satisfies OperationDefinition

export const canonOperationRegistry = {
    CanonSetRemoteMode,
    CanonSetEventMode,
    CanonRemoteReleaseOn,
    CanonRemoteReleaseOff,
    CanonSetDevicePropValue,
    CanonRequestDevicePropValue,
    CanonGetEventData,
    // CanonMovieSelectSWOn,
    // CanonMovieSelectSWOff,
} as const satisfies { [key: string]: OperationDefinition }

export type CanonOperationDef = (typeof canonOperationRegistry)[keyof typeof canonOperationRegistry]
