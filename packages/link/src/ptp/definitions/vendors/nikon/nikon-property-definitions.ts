import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { BitfieldCodec, EnumCodec } from '@ptp/types/codec'
import { PropertyDefinition } from '@ptp/types/property'

const UINT8 = getDatatypeByName('UINT8')!.code
const UINT32 = getDatatypeByName('UINT32')!.code

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

export const nikonPropertyRegistry = {
    LiveViewStatus,
    LiveViewSelector,
    MovieRecProhibitionCondition,
} as const

export type NikonPropertyDef = (typeof nikonPropertyRegistry)[keyof typeof nikonPropertyRegistry]
