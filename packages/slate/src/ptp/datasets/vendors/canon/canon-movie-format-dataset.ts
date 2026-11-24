import { CustomCodec } from '@ptp/types/codec'

export interface CanonMovieFormat {
    /** Stable identifier made from the exact record advertised by the camera. */
    key: string
    label: string
    resolution: string
    frameRate: number
    container: 'MOV' | 'MP4' | 'unknown'
    compression: 'ALL-I' | 'IPB (Standard)' | 'IPB (Light)' | 'unknown'
    wireValues: number[]
}

function describeMovieFormat(wireValues: number[]): Omit<CanonMovieFormat, 'key' | 'wireValues'> {
    const resolution =
        wireValues[2] === 0 ? 'Full HD' : wireValues[2] === 1 ? 'HD' : wireValues[2] === 5 ? '4K' : `size ${wireValues[2]}`
    const frameRate = (wireValues[3] || 0) / 100

    // These three fields were correlated against the EOS 80D's advertised
    // choices and Canon's recording-format table. Unknown combinations retain
    // their complete wire record instead of receiving a speculative label.
    const isMovAllI = wireValues[6] === 1 && wireValues[7] === 0
    const isMp4 = wireValues[6] === 3 && wireValues[7] === 1
    const container = isMovAllI ? 'MOV' : isMp4 ? 'MP4' : 'unknown'
    const compression = isMovAllI
        ? 'ALL-I'
        : isMp4 && wireValues[8] === 0
          ? 'IPB (Standard)'
          : isMp4 && wireValues[8] === 1
            ? 'IPB (Light)'
            : 'unknown'
    const frameRateLabel = Number.isInteger(frameRate) ? frameRate.toFixed(0) : frameRate.toFixed(2)
    return {
        resolution,
        frameRate,
        container,
        compression,
        label: `${resolution} ${frameRateLabel} fps · ${container} · ${compression}`,
    }
}

export function canonMovieFormatFromWire(wireValues: number[]): CanonMovieFormat {
    if (wireValues.length < 2 || wireValues[0] !== wireValues.length * 4) {
        throw new Error(`Invalid Canon movie format record (${wireValues.length} fields)`)
    }
    if (wireValues.some(value => !Number.isInteger(value) || value < 0 || value > 0xffffffff)) {
        throw new Error('Canon movie format fields must be unsigned 32-bit integers')
    }
    return {
        key: wireValues.join(':'),
        ...describeMovieFormat(wireValues),
        wireValues: [...wireValues],
    }
}

export class CanonMovieFormatCodec extends CustomCodec<CanonMovieFormat> {
    encode(value: CanonMovieFormat): Uint8Array {
        const format = canonMovieFormatFromWire(value.wireValues)
        const output = new Uint8Array(format.wireValues.length * 4)
        format.wireValues.forEach((field, index) => output.set(this.codecs.uint32.encode(field), index * 4))
        return output
    }

    decode(buffer: Uint8Array, offset = 0): { value: CanonMovieFormat; bytesRead: number } {
        if (offset + 4 > buffer.length) throw new Error('Canon movie format record is truncated')
        const byteLength = this.codecs.uint32.decode(buffer, offset).value
        if (byteLength < 8 || byteLength % 4 !== 0 || offset + byteLength > buffer.length) {
            throw new Error(`Invalid Canon movie format record length: ${byteLength}`)
        }
        const wireValues: number[] = []
        for (let position = offset; position < offset + byteLength; position += 4) {
            wireValues.push(this.codecs.uint32.decode(buffer, position).value)
        }
        return { value: canonMovieFormatFromWire(wireValues), bytesRead: byteLength }
    }
}
