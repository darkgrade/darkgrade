/**
 * PTP Object Formats with type validation
 */

import { FormatDefinition } from '@constants/types'

/**
 * PTP Object Formats with type validation
 */
export const PTPFormats = {
    UNDEFINED: {
        name: 'UNDEFINED',
        code: 0x3000,
        type: 'A',
        description: 'Undefined non-image object',
    },
    ASSOCIATION: {
        name: 'ASSOCIATION',
        code: 0x3001,
        type: 'A',
        description: 'Association (e.g. folder)',
    },
    SCRIPT: {
        name: 'SCRIPT',
        code: 0x3002,
        type: 'A',
        description: 'Device-model-specific script',
    },
    EXECUTABLE: {
        name: 'EXECUTABLE',
        code: 0x3003,
        type: 'A',
        description: 'Device-model-specific binary executable',
    },
    TEXT: {
        name: 'TEXT',
        code: 0x3004,
        type: 'A',
        description: 'Text file',
        fileExtension: '.txt',
    },
    HTML: {
        name: 'HTML',
        code: 0x3005,
        type: 'A',
        description: 'HTML file',
        fileExtension: '.html',
    },
    DPOF: {
        name: 'DPOF',
        code: 0x3006,
        type: 'A',
        description: 'Digital Print Order Format',
    },
    AIFF: {
        name: 'AIFF',
        code: 0x3007,
        type: 'A',
        description: 'AIFF audio',
        fileExtension: '.aiff',
    },
    WAV: {
        name: 'WAV',
        code: 0x3008,
        type: 'A',
        description: 'WAV audio',
        fileExtension: '.wav',
    },
    MP3: {
        name: 'MP3',
        code: 0x3009,
        type: 'A',
        description: 'MP3 audio',
        fileExtension: '.mp3',
    },
    AVI: {
        name: 'AVI',
        code: 0x300a,
        type: 'A',
        description: 'AVI video',
        fileExtension: '.avi',
    },
    MPEG: {
        name: 'MPEG',
        code: 0x300b,
        type: 'A',
        description: 'MPEG video',
        fileExtension: '.mpeg',
    },
    ASF: {
        name: 'ASF',
        code: 0x300c,
        type: 'A',
        description: 'Microsoft Advanced Streaming Format video',
        fileExtension: '.asf',
    },
    QUICKTIME: {
        name: 'QUICKTIME',
        code: 0x300d,
        type: 'A',
        description: 'Apple QuickTime video',
        fileExtension: '.mov',
    },
    XML: {
        name: 'XML',
        code: 0x300e,
        type: 'A',
        description: 'XML file',
        fileExtension: '.xml',
    },

    UNDEFINED_IMAGE: {
        name: 'UNDEFINED_IMAGE',
        code: 0x3800,
        type: 'I',
        description: 'Unknown image format',
    },
    EXIF_JPEG: {
        name: 'EXIF_JPEG',
        code: 0x3801,
        description: 'Exchangeable File Format, JEITA standard',
        fileExtension: '.jpg',
        type: 'I',
    },
    TIFF_EP: {
        name: 'TIFF_EP',
        code: 0x3802,
        description: 'Tag Image File Format for Electronic Photography',
        fileExtension: '.tiff',
        type: 'I',
    },
    FLASHPIX: {
        name: 'FLASHPIX',
        code: 0x3803,
        description: 'Structured Storage Image Format',
        type: 'I',
    },
    BMP: {
        name: 'BMP',
        code: 0x3804,
        description: 'Microsoft Windows Bitmap file',
        fileExtension: '.bmp',
        type: 'I',
    },
    CIFF: {
        name: 'CIFF',
        code: 0x3805,
        description: 'Canon Camera Image File Format',
        type: 'I',
    },
    UNDEFINED_RESERVED: {
        name: 'UNDEFINED_RESERVED',
        code: 0x3806,
        description: 'Reserved',
        type: 'I',
    },
    GIF: {
        name: 'GIF',
        code: 0x3807,
        description: 'Graphics Interchange Format',
        fileExtension: '.gif',
        type: 'I',
    },
    JFIF: {
        name: 'JFIF',
        code: 0x3808,
        description: 'JPEG File Interchange Format',
        fileExtension: '.jpg',
        type: 'I',
    },
    PCD: {
        name: 'PCD',
        code: 0x3809,
        description: 'PhotoCD Image Pac',
        type: 'I',
    },
    PICT: {
        name: 'PICT',
        code: 0x380a,
        description: 'Quickdraw Image Format',
        type: 'I',
    },
    PNG: {
        name: 'PNG',
        code: 0x380b,
        description: 'Portable Network Graphics',
        fileExtension: '.png',
        type: 'I',
    },
    UNDEFINED_RESERVED_2: {
        name: 'UNDEFINED_RESERVED_2',
        code: 0x380c,
        description: 'Reserved',
        type: 'I',
    },
    TIFF: {
        name: 'TIFF',
        code: 0x380d,
        description: 'Tag Image File Format',
        fileExtension: '.tiff',
        type: 'I',
    },
    TIFF_IT: {
        name: 'TIFF_IT',
        code: 0x380e,
        description: 'Tag Image File Format for Image Technology',
        type: 'I',
    },
    JP2: {
        name: 'JP2',
        code: 0x380f,
        description: 'JPEG 2000 baseline',
        fileExtension: '.jp2',
        type: 'I',
    },
    JPX: {
        name: 'JPX',
        code: 0x3810,
        description: 'JPEG 2000 extended',
        fileExtension: '.jpx',
        type: 'I',
    },
    DNG: {
        name: 'DNG',
        code: 0x3811,
        description: 'Digital Negative Format (PTP 1.1)',
        fileExtension: '.dng',
        type: 'I',
    },
} as const satisfies FormatDefinition

export type PTPFormatDefinitions = typeof PTPFormats
