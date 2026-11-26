import type { FormatDefinition } from '@ptp/types/format'

const sonyFormat = <
    const Code extends number,
    const Name extends string,
    const Description extends string,
    const Category extends FormatDefinition['category'],
>(
    code: Code,
    name: Name,
    description: Description,
    category: Category
) => ({ code, name, description, category }) as const

export const sonyFormatRegistry = {
    RAW: sonyFormat(0xb101, 'RAW', 'For RAW File', 'image'),
    HEIF: sonyFormat(0xb110, 'HEIF', 'For HEIF File', 'image'),
    MPO: sonyFormat(0xb301, 'MPO', 'For MPO File', 'image'),
    MP4: sonyFormat(0xb982, 'MP4', 'For MP4 File', 'video'),
} as const

export type SonyFormatDef = (typeof sonyFormatRegistry)[keyof typeof sonyFormatRegistry]
