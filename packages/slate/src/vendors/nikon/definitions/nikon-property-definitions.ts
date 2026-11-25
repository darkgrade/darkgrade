import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { STANDARD_FOCUS_MODES } from '@ptp/definitions/property-definitions'
import { BitfieldCodec, createEnumCodec, EnumCodec } from '@ptp/types/codec'
import { PropertyDefinition } from '@ptp/types/property'
import {nikonVideoPropertyRegistry} from '@vendors/nikon/video-properties'
import { nikonShootingPropertyRegistry } from '@vendors/nikon/definitions/nikon-shooting-property-definitions'

const UINT8 = getDatatypeByName('UINT8')!.code
const UINT16 = getDatatypeByName('UINT16')!.code
const UINT32 = getDatatypeByName('UINT32')!.code

/** Nikon Z5_2 USB/MTP reference §6.5.6.24; libgphoto2 PTP_DPC_NIKON_WarningStatus.
 * Bit 0 is sequence error. Keep all bits so unrelated faults cannot be mistaken for it.
 */
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
export const FocusMode = {
    code: 0x500a,
    name: 'FocusMode',
    description: 'Focus mode, with Nikon autofocus modes',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        createEnumCodec(
            registry,
            [
                ...STANDARD_FOCUS_MODES,
                { value: 0x8010, name: 'AF-S', description: 'Single-servo autofocus' },
                { value: 0x8011, name: 'AF-C', description: 'Continuous-servo autofocus' },
                { value: 0x8012, name: 'AF-A', description: 'Automatic AF-S / AF-C selection' },
                { value: 0x8013, name: 'AF-F', description: 'Full-time autofocus' },
            ] as const,
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const LiveViewStatus = {
    code: 0xd1b8,
    name: 'LiveViewStatus',
    description: 'Indicates the status of live view (ON or OFF)',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0, name: 'OFF', description: 'Live view is disabled' },
                { value: 1, name: 'ON', description: 'Live view is enabled' },
            ] as const,
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const LiveViewSelector = {
    code: 0xd1a6,
    name: 'LiveViewSelector',
    description: 'Indicates the state of live view mode (Photo Lv or Video Lv)',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0, name: 'PHOTO', description: 'Photo live view mode' },
                { value: 1, name: 'VIDEO', description: 'Video live view mode' },
            ] as const,
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

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

/** Nikon Z6III USB/MTP specification Rev.2.00, §6.5.15.2.
 * Keep the raw byte so newer connection types remain observable.
 */
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
    LiveViewStatus,
    LiveViewSelector,
    MovieRecProhibitionCondition,
} as const

export type NikonPropertyDef = (typeof nikonPropertyRegistry)[keyof typeof nikonPropertyRegistry]
