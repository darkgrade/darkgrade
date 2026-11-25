import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { ArrayCodec, baseCodecs, createEnumCodec, EnumCodec, type EnumValue, type PTPRegistry } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'
import { PropertyDefinition } from '@ptp/types/property'
import { NikonEventListCodec } from '@vendors/nikon/datasets/nikon-event-list-dataset'
import { NikonLiveViewDatasetCodec } from '@vendors/nikon/datasets/nikon-live-view-dataset'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'

const UINT8 = getDatatypeByName('UINT8')!.code

const required = <const Name extends string>(name: Name, description: string) =>
    ({ name, description, codec: baseCodecs.uint32, required: true }) as const
const optional = <const Name extends string>(name: Name, description: string) =>
    ({ name, description, codec: baseCodecs.uint32, required: false }) as const
/** An operation with the given data phase and parameters; add `dataCodec` by spreading. */
const operation = <
    const Code extends number,
    const Name extends string,
    const Direction extends 'none' | 'in' | 'out',
    const Parameters extends OperationDefinition['operationParameters'] = [],
    const Responses extends OperationDefinition['responseParameters'] = [],
>(
    code: Code,
    name: Name,
    description: string,
    dataDirection: Direction,
    operationParameters: Parameters,
    responseParameters: Responses
) => ({ code, name, description, dataDirection, operationParameters, responseParameters }) as const
/** An operation with no parameters and no data phase. */
const command = <const Code extends number, const Name extends string>(code: Code, name: Name, description: string) =>
    operation(code, name, description, 'none', [], [])

/** A UINT32 Mode parameter naming its wire values. */
const modeParameter = <const Values extends readonly EnumValue<number>[]>(description: string, values: Values) =>
    ({
        name: 'Mode',
        description,
        codec: (registry: PTPRegistry) => createEnumCodec(registry, values, registry.codecs.uint32),
        required: true,
    }) as const

export const ISOAutoControl = {
    code: 0xd054,
    name: 'ISOAutoControl',
    description: 'ISO sensitivity settings – Auto ISO sensitivity control',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0, name: 'OFF', description: 'Auto ISO control disabled' },
                { value: 1, name: 'ON', description: 'Auto ISO control enabled' },
            ] as const,
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const GetPartialObjectEx = operation(0x9431, 'GetPartialObjectEx', 'Get partial object with 64-bit offset support (extension of GetPartialObject)', 'out', [
    required('ObjectHandle', 'Object handle'),
    required('OffsetLower', 'Offset in bytes (lower 32 bits)'),
    required('OffsetUpper', 'Offset in bytes (upper 32 bits)'),
    required('MaxSizeLower', 'Maximum bytes to return (lower 32 bits)'),
    required('MaxSizeUpper', 'Maximum bytes to return (upper 32 bits)'),
], [
    required('ActualBytesSentLower', 'Actual bytes sent (lower 32 bits)'),
    required('ActualBytesSentUpper', 'Actual bytes sent (upper 32 bits)'),
])

export const GetVendorCodes = operation(0x9439, 'GetVendorCodes', 'Enumerate Nikon extended vendor codes (kind 13 selects device properties)', 'out', [required('Kind', 'Vendor code category; 13 for device properties')], [])

export const GetDevicePropDescEx = {
    ...operation(0x943a, 'GetDevicePropDescEx', 'Get device property descriptor (4-byte extension)', 'out', [
        required('DevicePropCode', 'Property code to get descriptor for (4-byte extension)'),
    ], []),
    dataCodec: (registry: PTPRegistry) => new DevicePropDescCodec(registry, true),
}

export const GetDevicePropValueEx = operation(0x943b, 'GetDevicePropValueEx', 'Get device property value (4-byte extension)', 'out', [required('DevicePropCode', 'Property code to get (4-byte extension)')], [])

export const SetDevicePropValueEx = operation(0x943c, 'SetDevicePropValueEx', 'Set device property value (4-byte extension)', 'in', [required('DevicePropCode', 'Property code to set (4-byte extension)')], [])

export const DeviceReady = command(0x90c8, 'DeviceReady', 'Check status of activation-type command (e.g. StartLiveView, AfDrive)')
export const StartLiveView = command(0x9201, 'StartLiveView', 'Start remote live view mode (activation-type command)')
export const EndLiveView = command(0x9202, 'EndLiveView', 'End remote live view mode')

export const GetLiveViewImageEx = {
    ...operation(0x9428, 'GetLiveViewImageEx', 'Get live view image with metadata (LiveViewObject with version)', 'out', [], []),
    dataCodec: (registry: PTPRegistry) => new NikonLiveViewDatasetCodec(registry),
}

export const StartMovieRecord = command(0x920a, 'StartMovieRecord', 'Start video recording (only accepted during live view)')
export const EndMovieRecord = command(0x920b, 'EndMovieRecord', 'End video recording')

export const ChangeCameraMode = operation(0x90c2, 'ChangeCameraMode', 'Switch between PC camera mode and remote mode', 'none', [
    modeParameter('Camera mode', [
        { value: 0x00, name: 'PC_CAMERA', description: 'Host commands ignored; dial/button settings apply' },
        { value: 0x01, name: 'REMOTE', description: 'Dials/buttons ignored; host commands apply' },
    ]),
], [])

export const ChangeApplicationMode = operation(0x9435, 'ChangeApplicationMode', 'Switch application mode on/off', 'none', [
    modeParameter('Application Mode', [
        { value: 0, name: 'OFF', description: 'Disallows playback, deletion, video recording on camera' },
        { value: 1, name: 'ON', description: 'Allows playback, deletion, video recording on camera' },
    ]),
], [])

/*
 * Nikon operations named in libgphoto2 ptp.h (https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h); parameter shapes from the ptp.h helper macros
 * cited per definition. Not hardware-verified in darkgrade unless a test-bench capture is cited.
 */

/** ptp.h#L581 ("1 param, no data"); helper ptp_nikon_capture(params, x), x "seen to be -1". */
export const InitiateCaptureRecInSdram = operation(0x90c0, 'InitiateCaptureRecInSdram', 'Captures into camera SDRAM (the image is not written to the card). Not hardware-verified.', 'none', [optional('Parameter', 'Unknown; libgphoto2 sends 0xFFFFFFFF')], [])

/** ptp.h#L582; helper ptp_nikon_afdrive sends no parameters. Completion is polled with DeviceReady. */
export const AfDrive = command(0x90c1, 'AfDrive', 'Starts autofocus (activation-type command; poll DeviceReady). Not hardware-verified.')

/** Nikon focus commands driven in live view; completion is reported by DeviceReady. */
export const AfDriveCancel = command(0x9206, 'AfDriveCancel', 'Cancel autofocus drive')

export const ChangeAfArea = operation(0x9205, 'ChangeAfArea', 'Place the autofocus area in Nikon live-view whole-size coordinates', 'none', [required('X', 'Horizontal coordinate'), required('Y', 'Vertical coordinate')], [])

export const MfDrive = operation(0x9204, 'MfDrive', 'Drive manual focus by bounded lens steps in live view', 'none', [
    required('Direction', '1 nearer, 2 farther'),
    required('Steps', 'Number of lens steps'),
], [])

/** ptp.h#L584 ("1 param (0x0: all, others: cancel this image)"); helper ptp_nikon_delete_sdram_image. */
export const DelImageSDRAM = operation(0x90c3, 'DelImageSDRAM', 'Deletes an image held in SDRAM after capture. Not hardware-verified.', 'none', [required('ObjectHandle', 'SDRAM object, or 0 for all')], [])

/** ptp.h#L588 ("no params, data in"); ptp.c ptp_nikon_check_event, dataset per ptp_unpack_Nikon_EC. */
export const GetEvent = {
    ...operation(0x90c7, 'GetEvent', 'Reads and clears the queued events (polled event delivery). Not hardware-verified.', 'out', [], []),
    dataCodec: (registry: PTPRegistry) => new NikonEventListCodec(registry),
}

/** ptp.h#L591 ("0 params, data in"); ptp.c ptp_nikon_get_vendorpropcodes reads a UINT16 array. */
export const GetVendorPropCodes = {
    ...operation(0x90ca, 'GetVendorPropCodes', 'Lists vendor property codes not advertised in DeviceInfo. Not hardware-verified.', 'out', [], []),
    dataCodec: (registry: PTPRegistry) => new ArrayCodec(registry, registry.codecs.uint16),
}

/** ptp.h#L592 ("no params, no data"); helper ptp_nikon_capture_sdram. */
export const AfCaptureSDRAM = command(0x90cb, 'AfCaptureSDRAM', 'Autofocuses, then captures into SDRAM. Not hardware-verified.')

/**
 * ptp.h#L602 ("no params, data in"); ptp.c ptp_nikon_get_liveview_image returns the raw data phase.
 * The bytes are a model-specific header followed by a JPEG, so they are returned undecoded.
 */
export const GetLiveViewImg = operation(0x9203, 'GetLiveViewImg', 'Gets one live-view frame (legacy, before GetLiveViewImageEx). Not hardware-verified.', 'out', [], [])

/**
 * ptp.h#L610; helpers ptp_nikon_capture2(af ? 0xFFFFFFFE : 0xFFFFFFFF, target) and
 * ptp_nikon_capture2_1 (one parameter, 0xFFFFFFFF).
 */
export const InitiateCaptureRecInMedia = operation(0x9207, 'InitiateCaptureRecInMedia', 'Captures to the memory card. Not hardware-verified.', 'none', [
    required('AfMode', '0xFFFFFFFE with autofocus, 0xFFFFFFFF without'),
    optional('Target', 'Capture destination (libgphoto2 passes it through)'),
], [])

/** GetEventEx has its own framing and explicit queue retention; SDK command rev 2 section 6.2.2.13. */
export const GetEventEx = {
    ...operation(0x941c, 'GetEventEx', 'Read Nikon extended events; retain with parameter 1, otherwise drain the queue.', 'out', [
        {
            name: 'KeepEvents',
            description: 'Omitted or DRAIN removes returned events; RETAIN leaves the queue unchanged.',
            codec: (registry: PTPRegistry) =>
                createEnumCodec(
                    registry,
                    [
                        { value: 0, name: 'DRAIN', description: 'Remove the returned events' },
                        { value: 1, name: 'RETAIN', description: 'Keep the returned events' },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: false,
        },
], []),
    dataCodec: (registry: PTPRegistry) => new NikonEventDataCodec(registry),
}

/** ptp.h#L638. */
export const MirrorUpCancel = command(0x941d, 'MirrorUpCancel', 'Cancels mirror-up. Not hardware-verified.')

/** ptp.h#L642 ("param: objecthandle, returns 64bit objectsize as DATA"). */
export const GetObjectSize = {
    ...operation(0x9421, 'GetObjectSize', 'Returns the 64-bit size of an object. Not hardware-verified.', 'out', [required('ObjectHandle', 'Object to size')], []),
    dataCodec: baseCodecs.uint64,
}

/*
 * Wireless-profile operations captured on the Nikon Z6 III (fw V2.00) on the darkgrade test bench
 * (darkgrade/test-bench@2db7a28:docs/evidence/nikon-z6-iii/wireless-profile-investigation.md). libgphoto2 does not name them; names describe the observed role only.
 */

/** 0x935D answered OK with response parameter 0x21 on the Z6 III. */
export const GetWirelessHardwareType = operation(0x935d, 'GetWirelessHardwareType', 'Reads the wireless hardware type (observed on Z6 III).', 'none', [], [required('HardwareType', 'Wireless hardware type (0x21 on Z6 III)')])

/** 0x936D answered OK with response parameter 1 on the Z6 III. */
export const GetSupportedWirelessProfileTypes = operation(0x936d, 'GetSupportedWirelessProfileTypes', 'Reads the supported wireless profile types (observed on Z6 III).', 'none', [], [required('ProfileTypes', 'Supported profile types (1 on Z6 III)')])

/** 0x90E8 with an empty password sent as the PTP string 01 00 00 answered OK on the Z6 III. */
export const WirelessAuthenticate = {
    ...operation(0x90e8, 'WirelessAuthenticate', 'Authenticates wireless-profile changes with a PTP-string password (observed on Z6 III).', 'in', [], []),
    dataCodec: baseCodecs.string,
}

/** 0x935A [0x2001] answered OperationNotSupported over USB on the Z6 III. */
export const CompleteWirelessPairing = operation(0x935a, 'CompleteWirelessPairing', 'Completes wireless pairing; the Z6 III refused it over USB (0x2005).', 'none', [required('Status', 'Pairing status (0x2001 sent)')], [])

/**
 * 0x90ef DeleteWirelessProfile was observed, but its request layout was not captured.
 * It deliberately remains outside the callable registry until a cited layout is available.
 */

export const nikonOperationRegistry = {
    GetVendorCodes,
    AfDrive,
    AfDriveCancel,
    ChangeAfArea,
    MfDrive,
    GetPartialObjectEx,
    GetDevicePropDescEx,
    GetDevicePropValueEx,
    SetDevicePropValueEx,
    DeviceReady,
    StartLiveView,
    EndLiveView,
    GetLiveViewImageEx,
    StartMovieRecord,
    EndMovieRecord,
    ChangeCameraMode,
    ChangeApplicationMode,
    InitiateCaptureRecInSdram,
    DelImageSDRAM,
    GetEvent,
    GetVendorPropCodes,
    AfCaptureSDRAM,
    GetLiveViewImg,
    InitiateCaptureRecInMedia,
    GetEventEx,
    MirrorUpCancel,
    GetObjectSize,
    GetWirelessHardwareType,
    GetSupportedWirelessProfileTypes,
    WirelessAuthenticate,
    CompleteWirelessPairing,
} as const satisfies { [key: string]: OperationDefinition }
