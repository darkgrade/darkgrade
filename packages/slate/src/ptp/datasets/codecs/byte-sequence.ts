import type { CodecInstance } from '@ptp/types/codec'

export function concatenateBytes(parts: readonly Uint8Array[]): Uint8Array {
    const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        result.set(part, offset)
        offset += part.length
    }
    return result
}

/** Decodes consecutive dataset fields from `buffer`, beginning at `start`. */
export class SequentialReader {
    private offset: number

    constructor(
        private readonly buffer: Uint8Array,
        private readonly start = 0
    ) {
        this.offset = start
    }

    read<Value>(codec: CodecInstance<Value>): Value {
        const result = codec.decode(this.buffer, this.offset)
        this.offset += result.bytesRead
        return result.value
    }

    get bytesRead(): number {
        return this.offset - this.start
    }
}
