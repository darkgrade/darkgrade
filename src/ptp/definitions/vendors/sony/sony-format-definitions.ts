import { FormatDefinition } from '@ptp/types/format'

export const RAW = {
    code: 0xb101,
    name: 'RAW',
    description: 'For RAW File',
    category: 'image',
} as const satisfies FormatDefinition

export const HEIF = {
    code: 0xb110,
    name: 'HEIF',
    description: 'For HEIF File',
    category: 'image',
} as const satisfies FormatDefinition

export const MPO = {
    code: 0xb301,
    name: 'MPO',
    description: 'For MPO File',
    category: 'image',
} as const satisfies FormatDefinition

export const MP4 = {
    code: 0xb982,
    name: 'MP4',
    description: 'For MP4 File',
    category: 'video',
} as const satisfies FormatDefinition

export const sonyFormatRegistry = {
    RAW,
    HEIF,
    MPO,
    MP4,
} as const

export type SonyFormatDef = (typeof sonyFormatRegistry)[keyof typeof sonyFormatRegistry]
