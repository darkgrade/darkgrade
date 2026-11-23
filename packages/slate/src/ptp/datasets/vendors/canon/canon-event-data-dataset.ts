import { CustomCodec } from '@ptp/types/codec'

export interface CanonEventRecord {
    code: number
    parameters: (number | bigint)[]
    /** Complete record body, including fields whose vendor meaning is not yet known. */
    rawData?: Uint8Array
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
        if (!Number.isInteger(offset) || offset < 0 || offset > buffer.length)
            throw new Error('Invalid Canon event offset')
        const events: CanonEventRecord[] = []
        let currentOffset = offset
        const u32 = this.codecs.uint32

        while (currentOffset < buffer.length) {
            if (buffer.length - currentOffset < 8) throw new Error('Truncated Canon event header')
            const eventOffset = currentOffset
            const sizeResult = u32.decode(buffer, currentOffset)
            const size = sizeResult.value
            currentOffset += sizeResult.bytesRead
            if (size < 8) throw new Error('Invalid Canon event record size')
            const eventEnd = eventOffset + size
            if (eventEnd > buffer.length) throw new Error('Truncated Canon event record')

            // EOS GetEvent records use uint32 size and event code, unlike USB event containers.
            // gphoto/libgphoto2@02d92fea8a269eb94330a4eade204ba799433606:camlibs/ptp2/ptp-pack.c
            const eventCodeResult = u32.decode(buffer, currentOffset)
            const eventCode = eventCodeResult.value
            currentOffset += eventCodeResult.bytesRead
            if (size === 8 && eventCode === 0) {
                break
            }
            const rawData = buffer.slice(currentOffset, eventEnd)

            if (eventCode === 0xc189) {
                if (size < 12) throw new Error('Truncated Canon property event')
                const propCodeResult = u32.decode(buffer, currentOffset)
                const propCode = propCodeResult.value
                currentOffset += propCodeResult.bytesRead
                const valueData = buffer.slice(currentOffset, eventEnd)
                const value = valueData.length >= 4 ? u32.decode(valueData).value : 0

                events.push({
                    code: eventCode,
                    parameters: [propCode, value],
                    rawData,
                    valueData,
                })
            } else if (eventCode === 0xc18a) {
                if (size < 20) throw new Error('Truncated Canon allowed-values event')
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

                if (type === 3) {
                    if (count > Math.floor((eventEnd - currentOffset) / 4))
                        throw new Error('Truncated Canon allowed-values list')
                    for (let index = 0; index < count; index++) {
                        if (currentOffset + 4 > eventEnd) throw new Error('Truncated Canon allowed value')
                        if (imageFormatPropertyCodes.has(propCode)) {
                            const entryCount = u32.decode(buffer, currentOffset).value
                            const valueSize = 4 + entryCount * 16
                            if ((entryCount !== 1 && entryCount !== 2) || currentOffset + valueSize > eventEnd)
                                throw new Error('Invalid Canon image-format choice')
                            allowedValueData.push(buffer.slice(currentOffset, currentOffset + valueSize))
                            currentOffset += valueSize
                        } else if (lengthPrefixedPropertyCodes.has(propCode)) {
                            const valueSize = u32.decode(buffer, currentOffset).value
                            if (valueSize < 4 || valueSize % 4 !== 0 || currentOffset + valueSize > eventEnd)
                                throw new Error('Invalid Canon length-prefixed choice')
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
                    rawData,
                    allowedValues: allowedValues.length > 0 || (type === 3 && count === 0) ? allowedValues : undefined,
                    allowedValueData: type === 3 ? allowedValueData : undefined,
                })
            } else {
                // Preserve opaque events for capture/replay without inventing parameter semantics.
                events.push({ code: eventCode, parameters: [], rawData })
            }
            currentOffset = eventEnd
        }

        return {
            value: events,
            bytesRead: currentOffset - offset,
        }
    }
}
