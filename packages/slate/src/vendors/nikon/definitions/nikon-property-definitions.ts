import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { STANDARD_FOCUS_MODES } from '@ptp/definitions/property-definitions'
import { BitfieldCodec, EnumCodec, type EnumValue } from '@ptp/types/codec'
import { PropertyDefinition } from '@ptp/types/property'
import { nikonVideoPropertyRegistry } from '@vendors/nikon/video-properties'
import { enumProperty, nikonShootingPropertyRegistry } from '@vendors/nikon/definitions/nikon-shooting-property-definitions'

const UINT8 = getDatatypeByName('UINT8')!.code
const UINT32 = getDatatypeByName('UINT32')!.code

/** Nikon Z5_2 USB/MTP reference §6.5.6.24; libgphoto2 PTP_DPC_NIKON_WarningStatus. All bits are kept. */
export const NikonWarningStatus = {
    code: 0xd102,
    name: 'NikonWarningStatus',
    description: 'Camera warning bits: bit 0 sequence error, bit 1 battery exhausted; read-only',
    datatype: UINT32,
    access: 'Get',
    codec: registry => registry.codecs.uint32,
} as const satisfies PropertyDefinition

/**
 * The standard FocusMode with Nikon's vendor values (libgphoto2 PTP_VENDOR_NIKON FocusMode:
 * 0x8010 AF-S, 0x8011 AF-C, 0x8012 AF-A, 0x8013 AF-F), next to the PTP 1.1 ones.
 */
export const FocusMode = enumProperty('FocusMode', 0x500a, 'uint16', 'Focus mode, with Nikon autofocus modes', [
    ...STANDARD_FOCUS_MODES,
    { value: 0x8010, name: 'AF-S', description: 'Single-servo autofocus' },
    { value: 0x8011, name: 'AF-C', description: 'Continuous-servo autofocus' },
    { value: 0x8012, name: 'AF-A', description: 'Automatic AF-S / AF-C selection' },
    { value: 0x8013, name: 'AF-F', description: 'Full-time autofocus' },
])

/**
 * The standard FocusMeteringMode (0x501C) as Nikon uses it for the AF-area mode, with Nikon's vendor
 * values (libgphoto2 camlibs/ptp2/config.c `nikon_d850_focus_metering`, 6d5c61ef, which marks
 * Pinpoint and the Wide-area values "on Z" and reads the property for the Z 6). A value without a
 * name here is left unrecognized, so it is never offered as a choice.
 */
export const NIKON_AF_AREA_VALUES = [
    { value: 0x0002, name: 'Dynamic-area AF (25 points)', description: 'Dynamic-area AF, 25 points' },
    { value: 0x8010, name: 'Single-point AF', description: 'Single-point AF' },
    { value: 0x8011, name: 'Auto-area AF', description: 'Auto-area AF: the camera chooses the focus point' },
    { value: 0x8012, name: '3D-tracking', description: '3D-tracking' },
    { value: 0x8013, name: 'Dynamic-area AF (72 points)', description: 'Dynamic-area AF, 72 points' },
    { value: 0x8014, name: 'Dynamic-area AF (153 points)', description: 'Dynamic-area AF, 153 points' },
    { value: 0x8015, name: 'Group-area AF', description: 'Group-area AF' },
    { value: 0x8016, name: 'Dynamic-area AF (9 points)', description: 'Dynamic-area AF, 9 points' },
    { value: 0x8017, name: 'Pinpoint AF', description: 'Pinpoint AF' },
    { value: 0x8018, name: 'Wide-area AF (S)', description: 'Wide-area AF, small' },
    { value: 0x8019, name: 'Wide-area AF (L)', description: 'Wide-area AF, large' },
    { value: 0x801e, name: 'Wide-area AF (C1)', description: 'Wide-area AF, custom 1' },
    { value: 0x801f, name: 'Wide-area AF (C2)', description: 'Wide-area AF, custom 2' },
] as const satisfies readonly EnumValue<number>[]
export const FocusMeteringMode = enumProperty('FocusMeteringMode', 0x501c, 'uint16', 'Nikon AF-area mode', NIKON_AF_AREA_VALUES)

/** A UINT8 GetSet property naming its values 0 and 1; decoded names stay plain strings. */
const twoStateProperty = <const Code extends number, const Name extends string>(
    code: Code,
    name: Name,
    description: string,
    states: readonly [EnumValue<number>, EnumValue<number>]
) =>
    ({
        code,
        name,
        description,
        datatype: UINT8,
        access: 'GetSet',
        codec: registry => new EnumCodec(registry, states, registry.codecs.uint8),
    }) as const satisfies PropertyDefinition

export const LiveViewStatus = twoStateProperty(0xd1b8, 'LiveViewStatus', 'Indicates the status of live view (ON or OFF)', [
    { value: 0, name: 'OFF', description: 'Live view is disabled' },
    { value: 1, name: 'ON', description: 'Live view is enabled' },
])

export const LiveViewSelector = twoStateProperty(
    0xd1a6,
    'LiveViewSelector',
    'Indicates the state of live view mode (Photo Lv or Video Lv)',
    [
        { value: 0, name: 'PHOTO', description: 'Photo live view mode' },
        { value: 1, name: 'VIDEO', description: 'Video live view mode' },
    ]
)

export const MovieRecProhibitionCondition = {
    code: 0xd0a4,
    name: 'MovieRecProhibitionCondition',
    description: 'Indicates video recording prohibition conditions (bitfield, 0 = allowed, non-zero = prohibited)',
    datatype: UINT32,
    access: 'Get',
    codec: registry =>
        new BitfieldCodec(
            registry,
            [
                { bit: 0, name: 'noCardInserted', description: 'No card inserted' },
                { bit: 1, name: 'cardAccessError', description: 'Card access error' },
                { bit: 2, name: 'cardNotFormatted', description: 'Card not formatted' },
                { bit: 3, name: 'noFreeSpace', description: 'No free area in the card' },
                { bit: 9, name: 'imagesInBuffer', description: 'Images or videos not recorded in buffer' },
                { bit: 10, name: 'alreadyRecording', description: 'During video recording' },
                { bit: 11, name: 'cardProtected', description: 'Card is protected' },
                { bit: 12, name: 'liveViewEnlarged', description: 'During enlarged display of live view' },
                { bit: 13, name: 'inPhotoMode', description: 'During photo mode' },
                { bit: 14, name: 'notInApplicationMode', description: 'Not in application mode' },
                { bit: 18, name: 'sequenceError', description: 'During sequence error' },
                { bit: 19, name: 'lensFactorWarning', description: 'During warning/error of lens factor' },
                { bit: 20, name: 'rawFormatRestriction', description: 'ProRes RAW/N-RAW with SD card or FAT32 format' },
            ] as const,
            registry.codecs.uint32
        ),
} as const satisfies PropertyDefinition

/** Nikon Z6III USB/MTP specification Rev.2.00, §6.5.15.2; the raw byte keeps newer connection types observable. */
export const ConnectionPath = {
    code: 0xd12e,
    name: 'ConnectionPath',
    description: 'Active Nikon PTP connection: 0 USB, 2 built-in Wi-Fi, 3 wired LAN',
    datatype: UINT8,
    access: 'Get',
    codec: registry => registry.codecs.uint8,
} as const satisfies PropertyDefinition

export const nikonPropertyRegistry = {
    ...nikonVideoPropertyRegistry,
    ...nikonShootingPropertyRegistry,
    ConnectionPath,
    NikonWarningStatus,
    FocusMode,
    FocusMeteringMode,
    LiveViewStatus,
    LiveViewSelector,
    MovieRecProhibitionCondition,
} as const
