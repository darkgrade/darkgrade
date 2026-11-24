import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { NikonEventListCodec } from '@ptp/datasets/vendors/nikon/nikon-event-list-dataset'
import { NikonLiveViewDatasetCodec } from '@ptp/datasets/vendors/nikon/nikon-live-view-dataset'
import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { ArrayCodec, baseCodecs, createEnumCodec, EnumCodec } from '@ptp/types/codec'
import { OperationDefinition } from '@ptp/types/operation'
import { PropertyDefinition } from '@ptp/types/property'
import { NikonEventDataCodec } from '@vendors/nikon/event-data'

const UINT8 = getDatatypeByName('UINT8')!.code

// Nikon-specific properties
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

export const GetPartialObjectEx = {
    code: 0x9431,
    name: 'GetPartialObjectEx',
    description: 'Get partial object with 64-bit offset support (extension of GetPartialObject)',
    dataDirection: 'out',
    operationParameters: [
        {
            name: 'ObjectHandle',
            description: 'Object handle',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'OffsetLower',
            description: 'Offset in bytes (lower 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'OffsetUpper',
            description: 'Offset in bytes (upper 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'MaxSizeLower',
            description: 'Maximum bytes to return (lower 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'MaxSizeUpper',
            description: 'Maximum bytes to return (upper 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [
        {
            name: 'ActualBytesSentLower',
            description: 'Actual bytes sent (lower 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
        {
            name: 'ActualBytesSentUpper',
            description: 'Actual bytes sent (upper 32 bits)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
} as const satisfies OperationDefinition

export const GetVendorCodes = {
    code: 0x9439,
    name: 'GetVendorCodes',
    description: 'Enumerate Nikon extended vendor codes (kind 13 selects device properties)',
    dataDirection: 'out',
    operationParameters: [
        { name: 'Kind', description: 'Vendor code category; 13 for device properties', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const GetDevicePropDescEx = {
    code: 0x943a,
    name: 'GetDevicePropDescEx',
    description: 'Get device property descriptor (4-byte extension)',
    dataDirection: 'out',
    dataCodec: registry => new DevicePropDescCodec(registry, true),
    operationParameters: [
        {
            name: 'DevicePropCode',
            description: 'Property code to get descriptor for (4-byte extension)',
            codec: baseCodecs.uint32,
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const GetDevicePropValueEx = {
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
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const SetDevicePropValueEx = {
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
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const DeviceReady = {
    code: 0x90c8,
    name: 'DeviceReady',
    description: 'Check status of activation-type command (e.g. StartLiveView, AfDrive)',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const StartLiveView = {
    code: 0x9201,
    name: 'StartLiveView',
    description: 'Start remote live view mode (activation-type command)',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const EndLiveView = {
    code: 0x9202,
    name: 'EndLiveView',
    description: 'End remote live view mode',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const GetLiveViewImageEx = {
    code: 0x9428,
    name: 'GetLiveViewImageEx',
    description: 'Get live view image with metadata (LiveViewObject with version)',
    dataDirection: 'out',
    dataCodec: registry => new NikonLiveViewDatasetCodec(registry),
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const StartMovieRecord = {
    code: 0x920a,
    name: 'StartMovieRecord',
    description: 'Start video recording (only accepted during live view)',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const EndMovieRecord = {
    code: 0x920b,
    name: 'EndMovieRecord',
    description: 'End video recording',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const ChangeCameraMode = {
    code: 0x90c2,
    name: 'ChangeCameraMode',
    description: 'Switch between PC camera mode and remote mode',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'Mode',
            description: 'Camera mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        {
                            value: 0x00,
                            name: 'PC_CAMERA',
                            description: 'PC Camera Mode: host commands ignored and uses settings from dial/buttons',
                        },
                        {
                            value: 0x01,
                            name: 'REMOTE',
                            description: 'Remote Mode: all dials/buttons ignored and uses commands from host',
                        },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const ChangeApplicationMode = {
    code: 0x9435,
    name: 'ChangeApplicationMode',
    description: 'Switch application mode on/off',
    dataDirection: 'none',
    operationParameters: [
        {
            name: 'Mode',
            description: 'Application Mode',
            codec: registry =>
                createEnumCodec(
                    registry,
                    [
                        {
                            value: 0,
                            name: 'OFF',
                            description: 'disallows image playback, deletion, video recording on the camera',
                        },
                        {
                            value: 1,
                            name: 'ON',
                            description: 'allows image playback, deletion, video recording on the camera',
                        },
                    ] as const,
                    registry.codecs.uint32
                ),
            required: true,
        },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/*
 * Nikon operations named in libgphoto2 ptp.h (https://github.com/gphoto/libgphoto2/blob/02d92fea8a269eb94330a4eade204ba799433606/camlibs/ptp2/ptp.h); parameter shapes from the ptp.h helper macros
 * cited per definition. Not hardware-verified in darkgrade unless a test-bench capture is cited.
 */

const uint32Parameter = (name: string, description: string, required = true) =>
    ({ name, description, codec: baseCodecs.uint32, required }) as const

/** ptp.h#L581 ("1 param, no data"); helper ptp_nikon_capture(params, x), x "seen to be -1". */
export const InitiateCaptureRecInSdram = {
    code: 0x90c0,
    name: 'InitiateCaptureRecInSdram',
    description: 'Captures into camera SDRAM (the image is not written to the card). Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [uint32Parameter('Parameter', 'Unknown; libgphoto2 sends 0xFFFFFFFF', false)] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L582; helper ptp_nikon_afdrive sends no parameters. Completion is polled with DeviceReady. */
export const AfDrive = {
    code: 0x90c1,
    name: 'AfDrive',
    description: 'Starts autofocus (activation-type command; poll DeviceReady). Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** Nikon focus commands driven in live view; completion is reported by DeviceReady. */
export const AfDriveCancel = {
    code: 0x9206,
    name: 'AfDriveCancel',
    description: 'Cancel autofocus drive',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const ChangeAfArea = {
    code: 0x9205,
    name: 'ChangeAfArea',
    description: 'Place the autofocus area in Nikon live-view whole-size coordinates',
    dataDirection: 'none',
    operationParameters: [
        { name: 'X', description: 'Horizontal coordinate', codec: baseCodecs.uint32, required: true },
        { name: 'Y', description: 'Vertical coordinate', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

export const MfDrive = {
    code: 0x9204,
    name: 'MfDrive',
    description: 'Drive manual focus by bounded lens steps in live view',
    dataDirection: 'none',
    operationParameters: [
        { name: 'Direction', description: '1 nearer, 2 farther', codec: baseCodecs.uint32, required: true },
        { name: 'Steps', description: 'Number of lens steps', codec: baseCodecs.uint32, required: true },
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L584 ("1 param (0x0: all, others: cancel this image)"); helper ptp_nikon_delete_sdram_image. */
export const DelImageSDRAM = {
    code: 0x90c3,
    name: 'DelImageSDRAM',
    description: 'Deletes an image held in SDRAM after capture. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [uint32Parameter('ObjectHandle', 'SDRAM object, or 0 for all')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L588 ("no params, data in"); ptp.c ptp_nikon_check_event, dataset per ptp_unpack_Nikon_EC. */
export const GetEvent = {
    code: 0x90c7,
    name: 'GetEvent',
    description: 'Reads and clears the queued events (polled event delivery). Not hardware-verified.',
    dataDirection: 'out',
    dataCodec: registry => new NikonEventListCodec(registry),
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L591 ("0 params, data in"); ptp.c ptp_nikon_get_vendorpropcodes reads a UINT16 array. */
export const GetVendorPropCodes = {
    code: 0x90ca,
    name: 'GetVendorPropCodes',
    description: 'Lists vendor property codes not advertised in DeviceInfo. Not hardware-verified.',
    dataDirection: 'out',
    dataCodec: registry => new ArrayCodec(registry, registry.codecs.uint16),
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L592 ("no params, no data"); helper ptp_nikon_capture_sdram. */
export const AfCaptureSDRAM = {
    code: 0x90cb,
    name: 'AfCaptureSDRAM',
    description: 'Autofocuses, then captures into SDRAM. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/**
 * ptp.h#L602 ("no params, data in"); ptp.c ptp_nikon_get_liveview_image returns the raw data phase.
 * The bytes are a model-specific header followed by a JPEG, so they are returned undecoded.
 */
export const GetLiveViewImg = {
    code: 0x9203,
    name: 'GetLiveViewImg',
    description: 'Gets one live-view frame (legacy, before GetLiveViewImageEx). Not hardware-verified.',
    dataDirection: 'out',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/**
 * ptp.h#L610; helpers ptp_nikon_capture2(af ? 0xFFFFFFFE : 0xFFFFFFFF, target) and
 * ptp_nikon_capture2_1 (one parameter, 0xFFFFFFFF).
 */
export const InitiateCaptureRecInMedia = {
    code: 0x9207,
    name: 'InitiateCaptureRecInMedia',
    description: 'Captures to the memory card. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [
        uint32Parameter('AfMode', '0xFFFFFFFE with autofocus, 0xFFFFFFFF without'),
        uint32Parameter('Target', 'Capture destination (libgphoto2 passes it through)', false),
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** GetEventEx has its own framing and explicit queue retention; SDK command rev 2 section 6.2.2.13. */
export const GetEventEx = {
    code: 0x941c,
    name: 'GetEventEx',
    description: 'Read Nikon extended events; retain with parameter 1, otherwise drain the queue.',
    dataDirection: 'out',
    dataCodec: registry => new NikonEventDataCodec(registry),
    operationParameters: [
        {
            name: 'KeepEvents',
            description: 'Omitted or DRAIN removes returned events; RETAIN leaves the queue unchanged.',
            codec: registry =>
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
    ] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L638. */
export const MirrorUpCancel = {
    code: 0x941d,
    name: 'MirrorUpCancel',
    description: 'Cancels mirror-up. Not hardware-verified.',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** ptp.h#L642 ("param: objecthandle, returns 64bit objectsize as DATA"). */
export const GetObjectSize = {
    code: 0x9421,
    name: 'GetObjectSize',
    description: 'Returns the 64-bit size of an object. Not hardware-verified.',
    dataDirection: 'out',
    dataCodec: baseCodecs.uint64,
    operationParameters: [uint32Parameter('ObjectHandle', 'Object to size')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/*
 * Wireless-profile operations captured on the Nikon Z6 III (fw V2.00) on the darkgrade test bench
 * (darkgrade/test-bench@2db7a28:docs/evidence/nikon-z6-iii/wireless-profile-investigation.md). libgphoto2 does not name them; names describe the observed role only.
 */

/** 0x935D answered OK with response parameter 0x21 on the Z6 III. */
export const GetWirelessHardwareType = {
    code: 0x935d,
    name: 'GetWirelessHardwareType',
    description: 'Reads the wireless hardware type (observed on Z6 III).',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [uint32Parameter('HardwareType', 'Wireless hardware type (0x21 on Z6 III)')] as const,
} as const satisfies OperationDefinition

/** 0x936D answered OK with response parameter 1 on the Z6 III. */
export const GetSupportedWirelessProfileTypes = {
    code: 0x936d,
    name: 'GetSupportedWirelessProfileTypes',
    description: 'Reads the supported wireless profile types (observed on Z6 III).',
    dataDirection: 'none',
    operationParameters: [] as const,
    responseParameters: [uint32Parameter('ProfileTypes', 'Supported profile types (1 on Z6 III)')] as const,
} as const satisfies OperationDefinition

/** 0x90E8 with an empty password sent as the PTP string 01 00 00 answered OK on the Z6 III. */
export const WirelessAuthenticate = {
    code: 0x90e8,
    name: 'WirelessAuthenticate',
    description: 'Authenticates wireless-profile changes with a PTP-string password (observed on Z6 III).',
    dataDirection: 'in',
    dataCodec: baseCodecs.string,
    operationParameters: [] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

/** 0x935A [0x2001] answered OperationNotSupported over USB on the Z6 III. */
export const CompleteWirelessPairing = {
    code: 0x935a,
    name: 'CompleteWirelessPairing',
    description: 'Completes wireless pairing; the Z6 III refused it over USB (0x2005).',
    dataDirection: 'none',
    operationParameters: [uint32Parameter('Status', 'Pairing status (0x2001 sent)')] as const,
    responseParameters: [] as const,
} as const satisfies OperationDefinition

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

export type NikonOperationDef = (typeof nikonOperationRegistry)[keyof typeof nikonOperationRegistry]
