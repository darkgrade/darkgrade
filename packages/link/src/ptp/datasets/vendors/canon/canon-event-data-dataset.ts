import { CustomCodec } from '@ptp/types/codec'

export interface CanonEventRecord {
    code: number
    parameters: (number | bigint)[]
    allowedValues?: number[]
}

export class CanonEventDataCodec extends CustomCodec<CanonEventRecord[]> {
    encode(value: CanonEventRecord[]): Uint8Array {
        throw new Error('CanonEventDataCodec.encode is not implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: CanonEventRecord[]; bytesRead: number } {
        const events: CanonEventRecord[] = []
        let currentOffset = offset
        const u16 = this.codecs.uint16
        const u32 = this.codecs.uint32

        while (currentOffset < buffer.length - 8) {
            const sizeResult = u32.decode(buffer, currentOffset)
            const size = sizeResult.value
            currentOffset += sizeResult.bytesRead

            if (size === 0 || size === 8) {
                break
            }

            if (size > buffer.length - (currentOffset - sizeResult.bytesRead)) {
                break
            }

            const eventCodeResult = u16.decode(buffer, currentOffset)
            const eventCode = eventCodeResult.value
            currentOffset += eventCodeResult.bytesRead

            if (eventCode === 0) {
                break
            }

            currentOffset += 2

            const payloadSize = size - 8

            if (eventCode === 0xc189) {
                const propCodeResult = u16.decode(buffer, currentOffset)
                const propCode = propCodeResult.value
                currentOffset += propCodeResult.bytesRead

                currentOffset += 2

                const valueResult = u32.decode(buffer, currentOffset)
                const value = valueResult.value
                currentOffset += valueResult.bytesRead

                events.push({
                    code: eventCode,
                    parameters: [propCode, value],
                })
            } else if (eventCode === 0xc18a) {
                const propCodeResult = u16.decode(buffer, currentOffset)
                const propCode = propCodeResult.value
                currentOffset += propCodeResult.bytesRead

                currentOffset += 2

                const typeResult = u32.decode(buffer, currentOffset)
                const type = typeResult.value
                currentOffset += typeResult.bytesRead

                const countResult = u32.decode(buffer, currentOffset)
                const count = countResult.value
                currentOffset += countResult.bytesRead

                const allowedValues: number[] = []

                if (type === 3 && count > 0 && count < 256) {
                    for (let i = 0; i < count; i++) {
                        const valueResult = u32.decode(buffer, currentOffset)
                        allowedValues.push(valueResult.value)
                        currentOffset += valueResult.bytesRead
                    }
                }

                events.push({
                    code: eventCode,
                    parameters: [propCode],
                    allowedValues: allowedValues.length > 0 ? allowedValues : undefined,
                })
            } else {
                currentOffset += payloadSize
            }
        }

        return {
            value: events,
            bytesRead: currentOffset - offset,
        }
    }
}
