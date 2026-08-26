import { CustomCodec } from '@ptp/types/codec'

export interface CanonEventRecord {
    code: number
    parameters: (number | bigint)[]
    valueData?: Uint8Array
    allowedValues?: number[]
    allowedValueData?: Uint8Array[]
}

const imageFormatPropertyCodes = new Set([0xd120, 0xd121, 0xd122, 0xd123])
const lengthPrefixedPropertyCodes = new Set([0xd1cd])

export class CanonEventDataCodec extends CustomCodec<CanonEventRecord[]> {
    encode(_value: CanonEventRecord[]): Uint8Array {
        throw new Error('CanonEventDataCodec.encode is not implemented')
    }

    decode(buffer: Uint8Array, offset = 0): { value: CanonEventRecord[]; bytesRead: number } {
        const events: CanonEventRecord[] = []
        let currentOffset = offset
        const u16 = this.codecs.uint16
        const u32 = this.codecs.uint32

        while (currentOffset <= buffer.length - 8) {
            const eventOffset = currentOffset
            const sizeResult = u32.decode(buffer, currentOffset)
            const size = sizeResult.value
            currentOffset += sizeResult.bytesRead

            if (size === 0 || size === 8) {
                break
            }

            const eventEnd = eventOffset + size
            if (eventEnd > buffer.length) {
                break
            }

            const eventCodeResult = u16.decode(buffer, currentOffset)
            const eventCode = eventCodeResult.value
            currentOffset += eventCodeResult.bytesRead

            if (eventCode === 0) {
                break
            }

            currentOffset += 2

            if (eventCode === 0xc189) {
                const propCodeResult = u32.decode(buffer, currentOffset)
                const propCode = propCodeResult.value
                currentOffset += propCodeResult.bytesRead
                const valueData = buffer.slice(currentOffset, eventEnd)
                const value = valueData.length >= 4 ? u32.decode(valueData).value : 0

                events.push({
                    code: eventCode,
                    parameters: [propCode, value],
                    valueData,
                })
            } else if (eventCode === 0xc18a) {
                const propCodeResult = u32.decode(buffer, currentOffset)
                const propCode = propCodeResult.value
                currentOffset += propCodeResult.bytesRead

                const typeResult = u32.decode(buffer, currentOffset)
                const type = typeResult.value
                currentOffset += typeResult.bytesRead

                const countResult = u32.decode(buffer, currentOffset)
                const count = countResult.value
                currentOffset += countResult.bytesRead

                const allowedValues: number[] = []
                const allowedValueData: Uint8Array[] = []

                if (type === 3 && count > 0 && count < 256) {
                    for (let index = 0; index < count && currentOffset < eventEnd; index++) {
                        if (imageFormatPropertyCodes.has(propCode)) {
                            const entryCount = u32.decode(buffer, currentOffset).value
                            const valueSize = 4 + entryCount * 16
                            if ((entryCount !== 1 && entryCount !== 2) || currentOffset + valueSize > eventEnd) break
                            allowedValueData.push(buffer.slice(currentOffset, currentOffset + valueSize))
                            currentOffset += valueSize
                        } else if (lengthPrefixedPropertyCodes.has(propCode)) {
                            const valueSize = u32.decode(buffer, currentOffset).value
                            if (valueSize < 4 || valueSize % 4 !== 0 || currentOffset + valueSize > eventEnd) break
                            allowedValueData.push(buffer.slice(currentOffset, currentOffset + valueSize))
                            currentOffset += valueSize
                        } else {
                            const valueResult = u32.decode(buffer, currentOffset)
                            allowedValues.push(valueResult.value)
                            allowedValueData.push(buffer.slice(currentOffset, currentOffset + 4))
                            currentOffset += 4
                        }
                    }
                }

                events.push({
                    code: eventCode,
                    parameters: [propCode],
                    allowedValues: allowedValues.length > 0 ? allowedValues : undefined,
                    allowedValueData: allowedValueData.length > 0 ? allowedValueData : undefined,
                })
            }
            currentOffset = eventEnd
        }

        return {
            value: events,
            bytesRead: currentOffset - offset,
        }
    }
}
