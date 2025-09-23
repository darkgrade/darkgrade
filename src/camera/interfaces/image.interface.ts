/**
 * Image information interface (simplified)
 */
export interface ImageInfo {
    id: string
    name: string
    size: number
    format: ImageFormat
    width: number
    height: number
    captureDate: Date
    // Optional detailed properties
    handle?: number
    storageId?: number
    objectFormat?: number
    protectionStatus?: number
    objectCompressedSize?: number
    thumbFormat?: number
    thumbCompressedSize?: number
    thumbPixWidth?: number
    thumbPixHeight?: number
    imagePixWidth?: number
    imagePixHeight?: number
    imageBitDepth?: number
    parentObject?: number
    associationType?: number
    associationDescription?: number
    sequenceNumber?: number
    filename?: string
    modificationDate?: Date
    keywords?: string
}

/**
 * Image data interface
 */
export interface ImageData {
    id: string
    data: Uint8Array
    format: ImageFormat
    width: number
    height: number
    size: number
    handle?: number
    filename?: string
    thumbnailData?: Uint8Array
}

/**
 * Image format enumeration
 */
export enum ImageFormat {
    JPEG = 'jpeg',
    RAW = 'raw',
    TIFF = 'tiff',
    BMP = 'bmp',
    PNG = 'png',
    HEIF = 'heif',
    DNG = 'dng',
    ARW = 'arw',
    CR2 = 'cr2',
    NEF = 'nef',
    UNKNOWN = 'unknown',
}
