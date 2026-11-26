import { CanonEventDataCodec } from '@vendors/canon/datasets/canon-event-data-dataset'
import { CanonExtendedDeviceInfoDatasetCodec } from '@vendors/canon/datasets/canon-extended-device-info-dataset'
import { CanonLiveViewDatasetCodec } from '@vendors/canon/datasets/canon-live-view-dataset'
import { enumCodec } from '@vendors/canon/definitions/canon-property-definitions'
import { baseCodecs, type EnumValue, PTPRegistry } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'

const uint32Parameter = (name: string, description: string, required = true) =>
    ({ name, description, codec: baseCodecs.uint32, required }) as const
const enumParameter = <const Name extends string, const Values extends readonly EnumValue<number>[]>(
    name: Name,
    description: string,
    values: Values
) => ({ name, description, codec: enumCodec('uint32', values), required: true }) as const

/** An operation without a data phase. */
const command = <
    const Code extends number,
    const Name extends string,
    const Parameters extends OperationDefinition['operationParameters'],
    const Responses extends OperationDefinition['responseParameters'],
>(
    code: Code,
    name: Name,
    description: string,
    operationParameters: Parameters,
    responseParameters: Responses
) => ({ code, name, description, dataDirection: 'none', operationParameters, responseParameters }) as const satisfies OperationDefinition

export const CanonGetExtendedDeviceInfo = {
    code: 0x9108,
    name: 'CanonGetExtendedDeviceInfo',
    description: 'Read Canon EOS extended event, property and remote-mode capabilities.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
    dataCodec: (registry: PTPRegistry) => new CanonExtendedDeviceInfoDatasetCodec(registry),
} as const satisfies OperationDefinition

export const CanonSetRemoteMode = command(0x9114, 'CanonSetRemoteMode', 'Set Remote Mode.', [
    enumParameter('RemoteMode', 'Remote mode', [
        { value: 0x00000001, name: 'ENABLE', description: 'Enable Remote Mode' },
        { value: 0x00000000, name: 'DISABLE', description: 'Disable Remote Mode' },
        // https://github.com/gphoto/libgphoto2/issues/1028#issuecomment-2382684065
        // https://github.com/user-attachments/files/17187948/remote-capture.txt
        {
            value: 0x00000002,
            name: 'MODE_0x02',
            description:
                'Remote mode 2 acknowledged in an EOS R5 Mark II public PTP export. ' +
                'Meaning and firmware not established; not a Photo-mode override. ' +
                'Source: gphoto/libgphoto2#1028, issuecomment-2382684065; ' +
                'attachment uploader Marcus Meissner (msmeissn), issue reporter karlkopf.',
        },
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
    ]),
], [])

export const CanonSetEventMode = command(0x9115, 'CanonSetEventMode', 'Set Event Mode.', [
    enumParameter('EventMode', 'Event mode', [
        { value: 0x00000001, name: 'ENABLE', description: 'Enable Event Mode' },
        { value: 0x00000000, name: 'DISABLE', description: 'Disable Event Mode' },
    ]),
], [])

export const CanonKeepDeviceOn = command(0x911d, 'CanonKeepDeviceOn', 'Reset the Canon EOS automatic power-off timer.', [], [])

export const CanonRemoteReleaseOn = command(0x9128, 'CanonRemoteReleaseOn', 'Remote Release On. First parameter: 1=half press, 2=full press, 3=half+full press. Second parameter: 0=AF enabled, 1=AF disabled (MF).', [
    enumParameter('ReleaseMode', 'Release mode', [
        { value: 0x00000001, name: 'FOCUS', description: 'Half Press (Focus)' },
        { value: 0x00000002, name: 'SHUTTER', description: 'Full Press (Shutter)' },
        {
            value: 0x00000003,
            name: 'FOCUS_AND_SHUTTER',
            description:
                'Half and full press in one request, as libgphoto2 sends to EOS M bodies ' +
                '(camlibs/ptp2/library.c @02d92fe, "Canon EOS M Full-Press"). Not hardware-verified.',
        },
    ]),
    enumParameter('AFMode', 'Autofocus mode: 0=AF enabled, 1=AF disabled (Manual Focus)', [
        { value: 0x00000000, name: 'AF', description: 'Autofocus Enabled' },
        { value: 0x00000001, name: 'MF', description: 'Manual Focus' },
    ]),
], [])

export const CanonRemoteReleaseOff = command(0x9129, 'CanonRemoteReleaseOff', 'Remote Release Off. Parameter: 1=release half, 2=release full, 3=release all.', [
    enumParameter('ReleaseMode', 'Release mode', [
        { value: 0x00000001, name: 'FOCUS', description: 'Release Half Press' },
        { value: 0x00000002, name: 'SHUTTER', description: 'Release Full Press' },
    ]),
], [])

export const CanonDoAutofocus = command(0x9154, 'CanonDoAutofocus', 'Drive Canon EOS autofocus without releasing the shutter.', [], [])

export const CanonCancelAutofocus = command(0x9160, 'CanonCancelAutofocus', 'Release a Canon EOS autofocus drive.', [], [])

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
export const CanonRequestDevicePropValue = command(0x9127, 'CanonRequestDevicePropValue', 'Request Property Value (Canon-specific). This operation requests the camera to send a property value via an event, it does not return the value directly.', [
    uint32Parameter('DevicePropCode', 'Property code'),
], [])

export const CanonGetEventData = {
    code: 0x9116,
    name: 'CanonGetEventData',
    description: 'Get Event Data (Canon-specific event polling).',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
    dataCodec: (registry: PTPRegistry) => new CanonEventDataCodec(registry),
} as const satisfies OperationDefinition

export const CanonMovieSelectSwitchOn = command(0x9133, 'CanonMovieSelectSwitchOn', 'Switch a Canon EOS body into its movie-select mode; this does not start recording.', [], [])

export const CanonMovieSelectSwitchOff = command(0x9134, 'CanonMovieSelectSwitchOff', 'Leave Canon EOS movie-select mode; this does not stop an active recording.', [], [])

/** EDSDK EVF trace: 0x9153 with parameters 0x00200000, 0, 0. */
export const CanonGetViewfinderData = {
    code: 0x9153,
    name: 'CanonGetViewfinderData',
    description: 'Read EOS USB live-view image and metadata segments.',
    dataDirection: 'out',
    dataCodec: registry => new CanonLiveViewDatasetCodec(registry),
    operationParameters: [
        uint32Parameter('Size', 'Requested maximum viewfinder payload size'),
        uint32Parameter('Reserved1', 'Reserved, zero'),
        uint32Parameter('Reserved2', 'Reserved, zero'),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const CanonViewfinderZoom = command(0x9158, 'CanonViewfinderZoom', 'Set live-view magnification (not optical or recorded-image zoom).', [uint32Parameter('Magnification', 'Preview magnification')], [])

export const CanonViewfinderPosition = command(0x9159, 'CanonViewfinderPosition', 'Move the magnified live-view viewport in camera sensor coordinates.', [
    uint32Parameter('X', 'Viewport origin X'),
    uint32Parameter('Y', 'Viewport origin Y'),
], [])

export const CanonTouchFramePoint = command(0x915b, 'CanonTouchFramePoint', 'Set the live-view frame center, as sent by EDSDK EdsSetFramePoint.', [
    uint32Parameter('Type', 'Frame point operation (3)'),
    uint32Parameter('X', 'Frame center X'),
    uint32Parameter('Y', 'Frame center Y'),
    uint32Parameter('Lock', 'Lock frame movement until an AF operation'),
], [])

/*
 * EOS operations named in libgphoto2 ptp.h (https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h).
 * Parameter shapes come from the ptp.h helper macros cited per definition. Not hardware-verified in
 * darkgrade unless a test-bench capture is cited.
 */

/** ptp.h#L414; ptp.c ptp_canon_eos_capture sends no parameters and reads an optional result parameter. */
export const CanonRemoteRelease = command(0x910f, 'CanonRemoteRelease', 'EOS one-shot remote release (libgphoto2 EOS_RemoteRelease). Not hardware-verified.', [], [uint32Parameter('Result', '0 when the release was accepted (libgphoto2)', false)])

/** ptp.h#L429, helper ptp_canon_eos_transfercomplete(params, handle). */
export const CanonTransferComplete = command(0x9117, 'CanonTransferComplete', 'Ends a direct object transfer from an EOS camera. Not hardware-verified.', [uint32Parameter('ObjectHandle', 'Transferred object')], [])

/** ptp.h#L435, helper ptp_canon_eos_pchddcapacity(params, inHDD, inLength, inReset). */
export const CanonPCHDDCapacity = command(0x911a, 'CanonPCHDDCapacity', 'Reports host storage capacity so the EOS body allows capture to the host. Not hardware-verified.', [
    uint32Parameter('HDD', 'Free host capacity in clusters (inHDD)'),
    uint32Parameter('Length', 'Cluster size in bytes (inLength)'),
    uint32Parameter('Reset', 'Reset flag (inReset)'),
], [])

/**
 * ptp.h#L438 (libgphoto2 sends no parameter). The EOS R6 Mark III answered OK to 0x911B [0] on the
 * darkgrade test bench (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md), so one optional parameter is accepted.
 */
export const CanonSetUILock = command(0x911b, 'CanonSetUILock', 'Locks the camera body controls while the host is in control.', [
    uint32Parameter('Reserved', 'Optional; 0 observed on EOS R6 Mark III, omitted by libgphoto2', false),
], [])

/**
 * ptp.h#L440. EOS R6 Mark III: OK after a lock, DeviceBusy for a redundant unlock or while live view
 * is active (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md).
 */
export const CanonResetUILock = command(0x911c, 'CanonResetUILock', 'Unlocks the camera body controls.', [], [])

/** ptp.h#L475, helper ptp_canon_eos_setrequestolcinfogroup(params, igmask). */
export const CanonSetRequestOLCInfoGroup = command(0x913d, 'CanonSetRequestOLCInfoGroup', 'Selects which OLC information groups the camera reports in its events. Not hardware-verified.', [uint32Parameter('GroupMask', 'Bit mask of requested OLC info groups')], [])

/**
 * ptp.h#L482 names the code; libgphoto2 does not send it. Request and response shapes are the EDSDK
 * traffic captured from the EOS R6 Mark III (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md): 0x913F [0x10000, 0x80000518, 0] answered
 * OK [0x80000518, 1].
 */
export const CanonGetCameraSupport = command(0x913f, 'CanonGetCameraSupport', 'EDSDK capability query (selector, property code) answered with a support value.', [
    uint32Parameter('Selector', 'Query selector (0x10000, 0x20000, 0x30000 observed)'),
    uint32Parameter('PropertyCode', 'Queried property or feature code (0x80000518 observed)'),
    uint32Parameter('Reserved', '0 observed'),
], [
    uint32Parameter('PropertyCode', 'Echo of the queried code'),
    uint32Parameter('Value', 'Support value (1 or 0xFFFFFFFF observed)'),
])

/** ptp.h#L500 ("no arg"), helper ptp_canon_eos_start_viewfinder. */
export const CanonInitiateViewfinder = command(0x9151, 'CanonInitiateViewfinder', 'Starts the EOS viewfinder (live view) session. Not hardware-verified in darkgrade.', [], [])

/** ptp.h#L501, helper ptp_canon_eos_end_viewfinder. */
export const CanonTerminateViewfinder = command(0x9152, 'CanonTerminateViewfinder', 'Ends the EOS viewfinder (live view) session. Not hardware-verified in darkgrade.', [], [])

/** ptp.h#L533. EOS R6 Mark III answered 0x917C [] with OK [0] (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md). */
export const CanonGetRemoteErrLogMode = command(0x917c, 'CanonGetRemoteErrLogMode', 'Reads the remote error-log mode.', [], [uint32Parameter('Mode', 'Error-log mode (0 observed)')])

/** ptp.h#L534. EOS R6 Mark III answered 0x917D [0] with OK [0] and no data phase (darkgrade/test-bench@2db7a28:.agents/skills/camera-re/references/canon-menu-ptp-investigation.md). */
export const CanonGetDebugLogEx = command(0x917d, 'CanonGetDebugLogEx', 'Debug-log query; on the R6 Mark III it answers with a response parameter, not a log file.', [uint32Parameter('Selector', 'Log selector (0 observed)')], [uint32Parameter('Value', 'Result (0 observed)')])

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
            codec: enumCodec('uint32', [{ value: 1, name: 'OBSERVED_FOLDER', description: 'Captured folder selector' }]),
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
