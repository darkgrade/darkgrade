import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { CanonExtendedDeviceInfoDatasetCodec } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
import { CanonLiveViewDatasetCodec } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import { baseCodecs, createEnumCodec, PTPRegistry } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

export const CanonGetExtendedDeviceInfo = {
    code: 0x9108,
    name: 'CanonGetExtendedDeviceInfo',
    description: 'Read Canon EOS extended event, property and remote-mode capabilities.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
    dataCodec: (registry: PTPRegistry) => new CanonExtendedDeviceInfoDatasetCodec(registry),
} as const satisfies OperationDefinition

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
                        {
                            value: 0x00000005,
                            name: 'MODE_0x05',
                            description:
                                'Remote mode 5, accepted by the EOS R6 Mark III (fw 1.0.1) on the darkgrade test bench ' +
                                '(test-bench@2db7a28 canon-menu-ptp-investigation.md). Meaning not documented.',
                        },
                        {
                            value: 0x00000011,
                            name: 'MODE_0x11',
                            description:
                                'Remote mode libgphoto2 sends to some PowerShot SX/G5 X bodies (camlibs/ptp2/config.c ' +
                                'camera_prepare_canon_eos_capture @02d92fe). Not hardware-verified in darkgrade.',
                        },
                        {
                            value: 0x00000015,
                            name: 'MODE_0x15',
                            description:
                                'Remote mode libgphoto2 sends by default to EOS M and newer PowerShot SX bodies ' +
                                '(camlibs/ptp2/config.c camera_prepare_canon_eos_capture @02d92fe). Not hardware-verified.',
                        },
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

export const CanonKeepDeviceOn = {
    code: 0x911d,
    name: 'CanonKeepDeviceOn',
    description: 'Reset the Canon EOS automatic power-off timer.',
    dataDirection: 'none',
    operationParameters: [] as const,
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
                        {
                            value: 0x00000003,
                            name: 'FOCUS_AND_SHUTTER',
                            description:
                                'Half and full press in one request, as libgphoto2 sends to EOS M bodies ' +
                                '(camlibs/ptp2/library.c @02d92fe, "Canon EOS M Full-Press"). Not hardware-verified.',
                        },
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

export const CanonDoAutofocus = {
    code: 0x9154,
    name: 'CanonDoAutofocus',
    description: 'Drive Canon EOS autofocus without releasing the shutter.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonCancelAutofocus = {
    code: 0x9160,
    name: 'CanonCancelAutofocus',
    description: 'Release a Canon EOS autofocus drive.',
    dataDirection: 'none',
    operationParameters: [] as const,
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

export const CanonMovieSelectSwitchOn = {
    code: 0x9133,
    name: 'CanonMovieSelectSwitchOn',
    description: 'Switch a Canon EOS body into its movie-select mode; this does not start recording.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonMovieSelectSwitchOff = {
    code: 0x9134,
    name: 'CanonMovieSelectSwitchOff',
    description: 'Leave Canon EOS movie-select mode; this does not stop an active recording.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** EDSDK EVF trace: 0x9153 with parameters 0x00200000, 0, 0. */
export const CanonGetViewfinderData = {
    code: 0x9153,
    name: 'CanonGetViewfinderData',
    description: 'Read EOS USB live-view image and metadata segments.',
    dataDirection: 'out',
    dataCodec: registry => new CanonLiveViewDatasetCodec(registry),
    operationParameters: [
        {
            name: 'Size',
            description: 'Requested maximum viewfinder payload size',
            codec: baseCodecs.uint32,
            required: true,
        },
        { name: 'Reserved1', description: 'Reserved, zero', codec: baseCodecs.uint32, required: true },
        { name: 'Reserved2', description: 'Reserved, zero', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonViewfinderZoom = {
    code: 0x9158,
    name: 'CanonViewfinderZoom',
    description: 'Set live-view magnification (not optical or recorded-image zoom).',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Magnification', description: 'Preview magnification', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonViewfinderPosition = {
    code: 0x9159,
    name: 'CanonViewfinderPosition',
    description: 'Move the magnified live-view viewport in camera sensor coordinates.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'X', description: 'Viewport origin X', codec: baseCodecs.uint32, required: true },
        { name: 'Y', description: 'Viewport origin Y', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonTouchFramePoint = {
    code: 0x915b,
    name: 'CanonTouchFramePoint',
    description: 'Set the live-view frame center, as sent by EDSDK EdsSetFramePoint.',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Type', description: 'Frame point operation (3)', codec: baseCodecs.uint32, required: true },
        { name: 'X', description: 'Frame center X', codec: baseCodecs.uint32, required: true },
        { name: 'Y', description: 'Frame center Y', codec: baseCodecs.uint32, required: true },
        {
            name: 'Lock',
            description: 'Lock frame movement until an AF operation',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/*
 * EOS operations named in libgphoto2 ptp.h (https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h).
 * Parameter shapes come from the ptp.h helper macros cited per definition. Not hardware-verified in
 * darkgrade unless a test-bench capture is cited.
 */

const uint32Parameter = (name: string, description: string, required = true) =>
    ({ name, description, codec: baseCodecs.uint32, required }) as const

/** ptp.h#L414; ptp.c ptp_canon_eos_capture sends no parameters and reads an optional result parameter. */
export const CanonRemoteRelease = {
    code: 0x910f,
    name: 'CanonRemoteRelease',
    description: 'EOS one-shot remote release (libgphoto2 EOS_RemoteRelease). Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [uint32Parameter('Result', '0 when the release was accepted (libgphoto2)', false)] as const,
} as const satisfies OperationDefinition

/** ptp.h#L429, helper ptp_canon_eos_transfercomplete(params, handle). */
export const CanonTransferComplete = {
    code: 0x9117,
    name: 'CanonTransferComplete',
    description: 'Ends a direct object transfer from an EOS camera. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [uint32Parameter('ObjectHandle', 'Transferred object')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L435, helper ptp_canon_eos_pchddcapacity(params, inHDD, inLength, inReset). */
export const CanonPCHDDCapacity = {
    code: 0x911a,
    name: 'CanonPCHDDCapacity',
    description: 'Reports host storage capacity so the EOS body allows capture to the host. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        uint32Parameter('HDD', 'Free host capacity in clusters (inHDD)'),
        uint32Parameter('Length', 'Cluster size in bytes (inLength)'),
        uint32Parameter('Reset', 'Reset flag (inReset)'),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/**
 * ptp.h#L438 (libgphoto2 sends no parameter). The EOS R6 Mark III answered OK to 0x911B [0] on the
 * darkgrade test bench (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md), so one optional parameter is accepted.
 */
export const CanonSetUILock = {
    code: 0x911b,
    name: 'CanonSetUILock',
    description: 'Locks the camera body controls while the host is in control.',
    dataDirection: 'none',
    operationParameters: [
        uint32Parameter('Reserved', 'Optional; 0 observed on EOS R6 Mark III, omitted by libgphoto2', false),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/**
 * ptp.h#L440. EOS R6 Mark III: OK after a lock, DeviceBusy for a redundant unlock or while live view
 * is active (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md).
 */
export const CanonResetUILock = {
    code: 0x911c,
    name: 'CanonResetUILock',
    description: 'Unlocks the camera body controls.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L475, helper ptp_canon_eos_setrequestolcinfogroup(params, igmask). */
export const CanonSetRequestOLCInfoGroup = {
    code: 0x913d,
    name: 'CanonSetRequestOLCInfoGroup',
    description: 'Selects which OLC information groups the camera reports in its events. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [uint32Parameter('GroupMask', 'Bit mask of requested OLC info groups')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/**
 * ptp.h#L482 names the code; libgphoto2 does not send it. Request and response shapes are the EDSDK
 * traffic captured from the EOS R6 Mark III (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md): 0x913F [0x10000, 0x80000518, 0] answered
 * OK [0x80000518, 1].
 */
export const CanonGetCameraSupport = {
    code: 0x913f,
    name: 'CanonGetCameraSupport',
    description: 'EDSDK capability query (selector, property code) answered with a support value.',
    dataDirection: 'none',
    operationParameters: [
        uint32Parameter('Selector', 'Query selector (0x10000, 0x20000, 0x30000 observed)'),
        uint32Parameter('PropertyCode', 'Queried property or feature code (0x80000518 observed)'),
        uint32Parameter('Reserved', '0 observed'),
    ] as const,
    responseParameters: [
        uint32Parameter('PropertyCode', 'Echo of the queried code'),
        uint32Parameter('Value', 'Support value (1 or 0xFFFFFFFF observed)'),
    ] as const,
} as const satisfies OperationDefinition

/** ptp.h#L500 ("no arg"), helper ptp_canon_eos_start_viewfinder. */
export const CanonInitiateViewfinder = {
    code: 0x9151,
    name: 'CanonInitiateViewfinder',
    description: 'Starts the EOS viewfinder (live view) session. Not hardware-verified in darkgrade.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L501, helper ptp_canon_eos_end_viewfinder. */
export const CanonTerminateViewfinder = {
    code: 0x9152,
    name: 'CanonTerminateViewfinder',
    description: 'Ends the EOS viewfinder (live view) session. Not hardware-verified in darkgrade.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L533. EOS R6 Mark III answered 0x917C [] with OK [0] (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md). */
export const CanonGetRemoteErrLogMode = {
    code: 0x917c,
    name: 'CanonGetRemoteErrLogMode',
    description: 'Reads the remote error-log mode.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [uint32Parameter('Mode', 'Error-log mode (0 observed)')] as const,
} as const satisfies OperationDefinition

/** ptp.h#L534. EOS R6 Mark III answered 0x917D [0] with OK [0] and no data phase (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md). */
export const CanonGetDebugLogEx = {
    code: 0x917d,
    name: 'CanonGetDebugLogEx',
    description: 'Debug-log query; on the R6 Mark III it answers with a response parameter, not a log file.',
    dataDirection: 'none',
    operationParameters: [uint32Parameter('Selector', 'Log selector (0 observed)')] as const,
    responseParameters: [uint32Parameter('Value', 'Result (0 observed)')] as const,
} as const satisfies OperationDefinition

/**
 * EOS R6 Mark III capture: darkgrade/test-bench@2db7a28,
 * .agents/skills/camera-re/references/canon-menu-ptp-investigation.md.
 * 0x9195 [1] returned OK with the 20-byte record
 * 14000000 000020a3 3130304d5344434600000000 ("100MSDCF").
 * Keep the response opaque: other selectors and the general record layout are not established.
 */
export const CanonGetFolderRecord = {
    code: 0x9195,
    name: 'CanonGetFolderRecord',
    description: 'Reads the folder record observed with selector 1 on EOS R6 Mark III; other selectors are unverified.',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'Selector',
            description: 'Only selector 1 is supported by the captured evidence.',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [{ value: 1, name: 'OBSERVED_FOLDER', description: 'Captured folder selector' }],
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const canonOperationRegistry = {
    CanonGetExtendedDeviceInfo,
    CanonSetRemoteMode,
    CanonSetEventMode,
    CanonKeepDeviceOn,
    CanonRemoteReleaseOn,
    CanonRemoteReleaseOff,
    CanonDoAutofocus,
    CanonCancelAutofocus,
    CanonSetDevicePropValue,
    CanonRequestDevicePropValue,
    CanonGetEventData,
    CanonMovieSelectSwitchOn,
    CanonMovieSelectSwitchOff,
    CanonGetViewfinderData,
    CanonViewfinderZoom,
    CanonViewfinderPosition,
    CanonTouchFramePoint,
    CanonRemoteRelease,
    CanonTransferComplete,
    CanonPCHDDCapacity,
    CanonSetUILock,
    CanonResetUILock,
    CanonSetRequestOLCInfoGroup,
    CanonGetCameraSupport,
    CanonInitiateViewfinder,
    CanonTerminateViewfinder,
    CanonGetRemoteErrLogMode,
    CanonGetDebugLogEx,
    CanonGetFolderRecord,
} as const satisfies { [key: string]: OperationDefinition }

export type CanonOperationDef = (typeof canonOperationRegistry)[keyof typeof canonOperationRegistry]
