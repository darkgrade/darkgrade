/** Width and height from a JPEG's start-of-frame header, without decoding the picture. */
export function readJpegSize(jpeg: Uint8Array): { width: number; height: number } | null {
    let offset = 2
    while (offset + 9 < jpeg.length) {
        if (jpeg[offset] !== 0xff) return null
        const marker = jpeg[offset + 1]
        const segmentLength = (jpeg[offset + 2] << 8) | jpeg[offset + 3]
        const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
        if (isStartOfFrame) {
            return {
                height: (jpeg[offset + 5] << 8) | jpeg[offset + 6],
                width: (jpeg[offset + 7] << 8) | jpeg[offset + 8],
            }
        }
        offset += 2 + segmentLength
    }
    return null
}
