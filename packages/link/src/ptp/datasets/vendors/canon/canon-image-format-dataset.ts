import { CustomCodec } from '@ptp/types/codec'

const singleFormatNames = new Map<number, string>([
    [0x0c, 'RAW'],
    [0x1c, 'mRAW'],
    [0x2c, 'sRAW'],
    [0x0b, 'cRAW'],
    [0x03, 'L'],
    [0x13, 'M'],
    [0x23, 'S'],
    [0x02, 'cL'],
    [0x12, 'cM'],
    [0x22, 'cS'],
    [0xd3, 'S1'],
    [0xe3, 'S2'],
    [0xf3, 'S3'],
    [0xd2, 'cS1'],
    [0xe2, 'cS2'],
    [0xf2, 'cS3'],
    [0x53, 'M1'],
    [0x63, 'M2'],
    [0x52, 'cM1'],
    [0x62, 'cM2'],
])

export interface CanonImageFormat {
    packed: number
    label: string
    entries: Array<{
        type: 'jpeg' | 'raw'
        size: number
        compression: number
        code: number
        label: string
    }>
}

function normalizeSize(size: number): number {
    return size >= 0x0e ? size - 1 : size
}

function wireSize(size: number): number {
    return size >= 0x0d ? size + 1 : size
}

export function canonImageFormatFromPacked(packed: number): CanonImageFormat {
    if (!Number.isInteger(packed) || packed < 0 || packed > 0xffff) {
        throw new Error(`Invalid Canon image format value: ${packed}`)
    }
    const codes = [(packed >> 8) & 0xff, packed & 0xff].filter((code, index) => index === 0 || code !== 0xff)
    const entries = codes.map(code => ({
        type: (code & 0x08) !== 0 ? ('raw' as const) : ('jpeg' as const),
        size: (code >> 4) & 0x0f,
        compression: code & 0x07,
        code,
        label: singleFormatNames.get(code) || `0x${code.toString(16).padStart(2, '0')}`,
    }))
    return { packed, label: entries.map(entry => entry.label).join(' + '), entries }
}

export class CanonImageFormatCodec extends CustomCodec<CanonImageFormat> {
    encode(value: CanonImageFormat): Uint8Array {
        const format = canonImageFormatFromPacked(value.packed)
        const output = new Uint8Array(4 + format.entries.length * 16)
        let offset = 0
        const write = (number: number): void => {
            output.set(this.codecs.uint32.encode(number), offset)
            offset += 4
        }
        write(format.entries.length)
        for (const entry of format.entries) {
            write(0x10)
            write(entry.type === 'raw' ? 6 : 1)
            write(wireSize(entry.size))
            write(entry.compression)
        }
        return output
    }

    decode(buffer: Uint8Array, offset = 0): { value: CanonImageFormat; bytesRead: number } {
        const startOffset = offset
        const entryCount = this.codecs.uint32.decode(buffer, offset).value
        offset += 4
        if (entryCount !== 1 && entryCount !== 2) throw new Error(`Invalid Canon image format entry count: ${entryCount}`)

        const codes: number[] = []
        for (let index = 0; index < entryCount; index++) {
            const entrySize = this.codecs.uint32.decode(buffer, offset).value
            offset += 4
            if (entrySize !== 0x10) throw new Error(`Invalid Canon image format entry size: ${entrySize}`)
            const type = this.codecs.uint32.decode(buffer, offset).value
            offset += 4
            const size = this.codecs.uint32.decode(buffer, offset).value
            offset += 4
            const compression = this.codecs.uint32.decode(buffer, offset).value
            offset += 4
            const code = (normalizeSize(size) << 4) | (compression & 0x07) | (type === 6 ? 0x08 : 0)
            codes.push(code)
        }
        const packed = ((codes[0] ?? 0xff) << 8) | (codes[1] ?? 0xff)
        return { value: canonImageFormatFromPacked(packed), bytesRead: offset - startOffset }
    }
}
