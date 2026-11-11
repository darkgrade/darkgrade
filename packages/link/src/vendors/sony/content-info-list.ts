/**
 * Sony's ContentInfoList (Camera Control PTP 3 reference, "ContentInfoList"): the card's contents as
 * the camera indexes them in Remote Control with Transfer Mode. Little-endian throughout.
 */

export interface SonyContentFile {
    fileId: number
    path: string
    format: number
    sizeBytes: number
    width?: number
    height?: number
    video?: {
        codec: number
        width: number
        height: number
        framesPerThousandSeconds: number
        bitRateMbps: number
        startTimeCode: number
        endTimeCode: number
    }
}

export interface SonyContent {
    contentType: number
    contentId: number
    representative: boolean
    createdUtcMs: number
    createdLocalMs: number
    rating: number
    protected: boolean
    files: SonyContentFile[]
}

export interface SonyContentInfoList {
    version: number
    listCreatedUtcMs: number
    slot: number
    contents: SonyContent[]
}

class Reader {
    private offset = 0
    constructor(private readonly view: DataView) {}
    get remaining(): number {
        return this.view.byteLength - this.offset
    }
    skip(bytes: number): void {
        this.need(bytes)
        this.offset += bytes
    }
    uint16(): number {
        this.need(2)
        const value = this.view.getUint16(this.offset, true)
        this.offset += 2
        return value
    }
    uint32(): number {
        this.need(4)
        const value = this.view.getUint32(this.offset, true)
        this.offset += 4
        return value
    }
    int32(): number {
        this.need(4)
        const value = this.view.getInt32(this.offset, true)
        this.offset += 4
        return value
    }
    uint64(): number {
        this.need(8)
        const value = this.view.getBigUint64(this.offset, true)
        this.offset += 8
        return Number(value)
    }
    utf8(length: number): string {
        this.need(length)
        const bytes = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, length)
        this.offset += length
        return new TextDecoder().decode(bytes).replace(/\0+$/, '')
    }
    private need(bytes: number): void {
        if (bytes < 0 || this.offset + bytes > this.view.byteLength)
            throw new Error('Sony ContentInfoList is truncated')
    }
}

function readFile(reader: Reader): SonyContentFile {
    const fileId = reader.uint16()
    reader.skip(2)
    const path = reader.utf8(reader.uint32())
    const format = reader.uint32()
    const sizeBytes = reader.uint64()
    reader.skip(32) // UMID
    const file: SonyContentFile = { fileId, path, format, sizeBytes }
    if (reader.uint32() !== 0) {
        file.width = reader.uint32()
        file.height = reader.uint32()
    }
    if (reader.uint32() !== 0) {
        const startTimeCode = reader.uint32()
        const endTimeCode = reader.uint32()
        const codec = reader.uint32()
        reader.skip(4 * 2) // ProxyStatus, GOP_Structure
        const width = reader.uint32()
        const height = reader.uint32()
        reader.skip(4 * 3) // AspectRatio, ColorFormat, ImageBitDepth
        const framesPerThousandSeconds = reader.uint32()
        reader.skip(4) // ScanType
        const bitRateMbps = reader.uint32()
        reader.skip(4 * 6) // ImageFrames…, ProfileIndication, ProfileLevel, three RDD18 fields
        file.video = { codec, width, height, framesPerThousandSeconds, bitRateMbps, startTimeCode, endTimeCode }
    }
    if (reader.uint32() !== 0) reader.skip(4 * 4) // AudioParam
    return file
}

export function parseSonyContentInfoList(data: Uint8Array): SonyContentInfoList {
    const reader = new Reader(new DataView(data.buffer, data.byteOffset, data.byteLength))
    const version = reader.uint16()
    reader.skip(2)
    const listCreatedUtcMs = reader.uint64()
    reader.skip(64 + 64) // PhysicalMediaID, DatabaseID
    const slot = reader.uint32()
    const count = reader.uint32()
    const contents: SonyContent[] = []
    for (let index = 0; index < count && reader.remaining > 0; index++) {
        const contentType = reader.uint32()
        const contentId = reader.uint32()
        reader.skip(4 * 4) // DirNumber, FileNumber, GroupType, GroupID
        const representative = reader.uint32() !== 0
        const createdUtcMs = reader.uint64()
        reader.skip(8) // ModificationDateTime
        const createdLocalMs = reader.uint64()
        reader.skip(8) // ModificationDateTimeLocalTime
        const rating = reader.int32()
        const isProtected = reader.uint32() !== 0
        reader.skip(4) // DummyContent
        reader.skip(reader.uint32()) // Shotmarks: one byte each
        const fileCount = reader.uint32()
        const files: SonyContentFile[] = []
        for (let file = 0; file < fileCount; file++) files.push(readFile(reader))
        // Deleted content is compacted to the front and the rest zero-filled (content type 0).
        if (contentType === 0) continue
        contents.push({ contentType, contentId, representative, createdUtcMs, createdLocalMs, rating, protected: isProtected, files })
    }
    return { version, listCreatedUtcMs, slot, contents }
}
