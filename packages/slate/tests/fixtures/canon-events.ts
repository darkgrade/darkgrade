import { CanonEventDataCodec, type CanonEventRecord } from '@vendors/canon/datasets/canon-event-data-dataset'
import type { CanonRegistry } from '@vendors/registry'

/**
 * EOS GetEvent records on the wire, decoded by the real codec. ObjectAddedEx follows libgphoto2
 * ptp-pack.c (PTP_cee_OA_*): handle 0x08, storage 0x0c, format 0x10, size 0x1c, name 0x28.
 */
export function canonObjectAdded(handle: number, filename: string, sizeBytes: number, storageId = 0x00010001): Uint8Array {
    const name = new TextEncoder().encode(filename)
    const size = 0x28 + name.length + 1
    const record = new DataView(new ArrayBuffer(size))
    record.setUint32(0, size, true)
    record.setUint32(4, 0xc181, true)
    record.setUint32(0x08, handle, true)
    record.setUint32(0x0c, storageId, true)
    record.setUint16(0x10, /\.jpe?g$/i.test(filename) ? 0x3801 : 0xb982, true)
    record.setUint32(0x1c, sizeBytes, true)
    const bytes = new Uint8Array(record.buffer)
    bytes.set(name, 0x28)
    return bytes
}

export function canonValue(code: number, value: number): Uint8Array {
    const record = new DataView(new ArrayBuffer(16))
    record.setUint32(0, 16, true)
    record.setUint32(4, 0xc189, true)
    record.setUint32(8, code, true)
    record.setUint32(12, value, true)
    return new Uint8Array(record.buffer)
}

export function canonAllowedValues(code: number, choices: number[]): Uint8Array {
    const record = new DataView(new ArrayBuffer(20 + choices.length * 4))
    record.setUint32(0, 20 + choices.length * 4, true)
    record.setUint32(4, 0xc18a, true)
    record.setUint32(8, code, true)
    record.setUint32(12, 3, true)
    record.setUint32(16, choices.length, true)
    choices.forEach((choice, index) => record.setUint32(20 + index * 4, choice, true))
    return new Uint8Array(record.buffer)
}

/** One GetEvent reply: the records, then the terminator, decoded as the driver receives it. */
export function canonEvents(registry: CanonRegistry, records: Uint8Array[]): CanonEventRecord[] {
    const parts = [...records, Uint8Array.of(8, 0, 0, 0, 0, 0, 0, 0)]
    const wire = new Uint8Array(parts.reduce((total, part) => total + part.length, 0))
    let offset = 0
    for (const part of parts) {
        wire.set(part, offset)
        offset += part.length
    }
    return new CanonEventDataCodec(registry).decode(wire).value
}
