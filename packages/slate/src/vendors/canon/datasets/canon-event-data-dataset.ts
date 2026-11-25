import { CustomCodec } from '@ptp/types/codec'

export interface CanonEventRecord {
    code: number
    parameters: (number | bigint)[]
    /** Complete record body, including fields whose vendor meaning is not yet known. */
    rawData?: Uint8Array
    valueData?: Uint8Array
    allowedValues?: number[]
    allowedValueData?: Uint8Array[]
    /** The file an ObjectAddedEx, ObjectAddedEx64 or ObjectAddedEx64LFN record announces. */
    object?: CanonAddedObject
}

/** Only the handle is relied on: ObjectInfo is read for the file's name, format and real size. */
export interface CanonAddedObject {
    handle: number
}

/**
 * ObjectAddedEx (0xc181), ObjectAddedEx64 (0xc1a7) and ObjectAddedEx64LFN (0xc1b6), from
 * gphoto/libgphoto2 @6d5c61ef7687b74fe792e4aeae7fc40f2ad42d88 camlibs/ptp2/ptp.h (event codes)
 * and ptp-pack.c (PTP_cee_OA*_Handle 0x08 from the record start, so 0 after its size/code header).
 * The name offset differs between the three and libgphoto2 decodes none for 0xc1b6.
 */
const objectAddedCodes = new Set([0xc181, 0xc1a7, 0xc1b6])

function addedObject(body: Uint8Array): CanonAddedObject | undefined {
    if (body.length < 4) return undefined
    const handle = new DataView(body.buffer, body.byteOffset, body.byteLength).getUint32(0, true)
    return handle === 0 ? undefined : { handle }
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
        const readWord = () => {
            const value = u32.decode(buffer, currentOffset).value
            currentOffset += 4
            return value
        }

        // EOS GetEvent records use uint32 size and event code, unlike USB event containers.
        // gphoto/libgphoto2@02d92fea8a269eb94330a4eade204ba799433606:camlibs/ptp2/ptp-pack.c
        while (currentOffset < buffer.length) {
            if (buffer.length - currentOffset < 8) throw new Error('Truncated Canon event header')
            const eventOffset = currentOffset
            const size = readWord()
            const eventEnd = eventOffset + size
            if (size < 8) throw new Error('Invalid Canon event record size')
            if (eventEnd > buffer.length) throw new Error('Truncated Canon event record')
            const eventCode = readWord()
            if (size === 8 && eventCode === 0) break
            const rawData = buffer.slice(currentOffset, eventEnd)

            if (eventCode === 0xc189) {
                if (size < 12) throw new Error('Truncated Canon property event')
                const propCode = readWord()
                const valueData = buffer.slice(currentOffset, eventEnd)
                const value = valueData.length >= 4 ? u32.decode(valueData).value : 0
                events.push({ code: eventCode, parameters: [propCode, value], rawData, valueData })
            } else if (eventCode === 0xc18a) {
                if (size < 20) throw new Error('Truncated Canon allowed-values event')
                const propCode = readWord()
                const type = readWord()
                const count = readWord()
                const allowedValues: number[] = []
                const allowedValueData: Uint8Array[] = []
                const takeChoice = (valueSize: number) => {
                    allowedValueData.push(buffer.slice(currentOffset, currentOffset + valueSize))
                    currentOffset += valueSize
                }

                if (type === 3) {
                    if (count > Math.floor((eventEnd - currentOffset) / 4))
                        throw new Error('Truncated Canon allowed-values list')
                    for (let index = 0; index < count; index++) {
                        if (currentOffset + 4 > eventEnd) throw new Error('Truncated Canon allowed value')
                        const word = u32.decode(buffer, currentOffset).value
                        if (imageFormatPropertyCodes.has(propCode)) {
                            const valueSize = 4 + word * 16
                            if ((word !== 1 && word !== 2) || currentOffset + valueSize > eventEnd)
                                throw new Error('Invalid Canon image-format choice')
                            takeChoice(valueSize)
                        } else if (lengthPrefixedPropertyCodes.has(propCode)) {
                            if (word < 4 || word % 4 !== 0 || currentOffset + word > eventEnd)
                                throw new Error('Invalid Canon length-prefixed choice')
                            takeChoice(word)
                        } else {
                            allowedValues.push(word)
                            takeChoice(4)
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
            } else if (objectAddedCodes.has(eventCode)) {
                const object = addedObject(rawData)
                events.push({ code: eventCode, parameters: object ? [object.handle] : [], rawData, ...(object && { object }) })
            } else {
                // Preserve opaque events for capture/replay without inventing parameter semantics.
                events.push({ code: eventCode, parameters: [], rawData })
            }
            currentOffset = eventEnd
        }

        return { value: events, bytesRead: currentOffset - offset }
    }
}
