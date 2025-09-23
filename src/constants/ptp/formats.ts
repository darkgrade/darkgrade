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
    description: 'Undefined object format'
  },
  ASSOCIATION: {
    name: 'ASSOCIATION',
    code: 0x3001,
    description: 'Association (folder)',
  },
  SCRIPT: {
    name: 'SCRIPT',
    code: 0x3002,
    description: 'Script file'
  },
  EXECUTABLE: {
    name: 'EXECUTABLE',
    code: 0x3003,
    description: 'Executable file'
  },
  TEXT: {
    name: 'TEXT',
    code: 0x3004,
    description: 'Text file',
    fileExtension: '.txt',
    mimeType: 'text/plain'
  },
  HTML: {
    name: 'HTML',
    code: 0x3005,
    description: 'HTML file',
    fileExtension: '.html',
    mimeType: 'text/html'
  },
  DPOF: {
    name: 'DPOF',
    code: 0x3006,
    description: 'Digital Print Order Format'
  },
  AIFF: {
    name: 'AIFF',
    code: 0x3007,
    description: 'AIFF audio',
    fileExtension: '.aiff',
    mimeType: 'audio/aiff'
  },
  WAV: {
    name: 'WAV',
    code: 0x3008,
    description: 'WAV audio',
    fileExtension: '.wav',
    mimeType: 'audio/wav'
  },
  MP3: {
    name: 'MP3',
    code: 0x3009,
    description: 'MP3 audio',
    fileExtension: '.mp3',
    mimeType: 'audio/mp3'
  },
  AVI: {
    name: 'AVI',
    code: 0x300A,
    description: 'AVI video',
    fileExtension: '.avi',
    mimeType: 'video/avi'
  },
  MPEG: {
    name: 'MPEG',
    code: 0x300B,
    description: 'MPEG video',
    fileExtension: '.mpeg',
    mimeType: 'video/mpeg'
  },
  ASF: {
    name: 'ASF',
    code: 0x300C,
    description: 'Advanced Systems Format'
  },
  UNKNOWN_IMAGE: {
    name: 'UNKNOWN_IMAGE',
    code: 0x3800,
    description: 'Unknown image format'
  },
  EXIF_JPEG: {
    name: 'EXIF_JPEG',
    code: 0x3801,
    description: 'EXIF/JPEG image',
    fileExtension: '.jpg',
    mimeType: 'image/jpeg'
  },
  TIFF_EP: {
    name: 'TIFF_EP',
    code: 0x3802,
    description: 'TIFF EP format',
    fileExtension: '.tiff',
    mimeType: 'image/tiff'
  },
  FLASHPIX: {
    name: 'FLASHPIX',
    code: 0x3803,
    description: 'FlashPix format'
  },
  BMP: {
    name: 'BMP',
    code: 0x3804,
    description: 'Bitmap image',
    fileExtension: '.bmp',
    mimeType: 'image/bmp'
  },
  CIFF: {
    name: 'CIFF',
    code: 0x3805,
    description: 'Canon Camera Image File Format'
  },
  GIF: {
    name: 'GIF',
    code: 0x3807,
    description: 'GIF image',
    fileExtension: '.gif',
    mimeType: 'image/gif'
  },
  JFIF: {
    name: 'JFIF',
    code: 0x3808,
    description: 'JPEG File Interchange Format',
    fileExtension: '.jpg',
    mimeType: 'image/jpeg'
  },
  PCD: {
    name: 'PCD',
    code: 0x3809,
    description: 'PhotoCD format'
  },
  PICT: {
    name: 'PICT',
    code: 0x380A,
    description: 'PICT format'
  },
  PNG: {
    name: 'PNG',
    code: 0x380B,
    description: 'PNG image',
    fileExtension: '.png',
    mimeType: 'image/png'
  },
  TIFF: {
    name: 'TIFF',
    code: 0x380D,
    description: 'TIFF image',
    fileExtension: '.tiff',
    mimeType: 'image/tiff'
  },
  TIFF_IT: {
    name: 'TIFF_IT',
    code: 0x380E,
    description: 'TIFF/IT format'
  },
  JP2: {
    name: 'JP2',
    code: 0x380F,
    description: 'JPEG 2000 baseline',
    fileExtension: '.jp2',
    mimeType: 'image/jp2'
  },
  JPX: {
    name: 'JPX',
    code: 0x3810,
    description: 'JPEG 2000 extended',
    fileExtension: '.jpx',
    mimeType: 'image/jpx'
  }
} as const satisfies FormatDefinition

export type PTPFormatDefinitions = typeof PTPFormats