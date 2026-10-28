import { CustomCodec } from '@ptp/types/codec'

export interface NikonQueuedEvent {
    code: number
    parameter: number
}

const COUNT_BYTES = 2
const ENTRY_BYTES = 6

/**
 * The event queue Nikon's GetEvent (0x90C7) returns: a UINT16 count followed by that many
 * (UINT16 event code, UINT32 parameter) entries, little-endian. Layout as unpacked by libgphoto2
 * ptp_unpack_Nikon_EC (camlibs/ptp2/ptp-pack.c @02d92fe, PTP_nikon_ec_* offsets 0/2/4, entry size 6).
 * A count that overruns the payload is rejected rather than read past the end.
 */
export class NikonEventListCodec extends CustomCodec<NikonQueuedEvent[]> {
    encode(events: NikonQueuedEvent[]): Uint8Array {
        const bytes = new Uint8Array(COUNT_BYTES + events.length * ENTRY_BYTES)
        const view = new DataView(bytes.buffer)
        view.setUint16(0, events.length, true)
        events.forEach((event, index) => {
            view.setUint16(COUNT_BYTES + index * ENTRY_BYTES, event.code, true)
            view.setUint32(COUNT_BYTES + index * ENTRY_BYTES + 2, event.parameter >>> 0, true)
        })
        return bytes
    }

    decode(buffer: Uint8Array, offset = 0): { value: NikonQueuedEvent[]; bytesRead: number } {
        const available = buffer.length - offset
        if (available < COUNT_BYTES) throw new Error(`Nikon event list needs ${COUNT_BYTES} bytes, got ${available}`)
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset, available)
        const count = view.getUint16(0, true)
        const length = COUNT_BYTES + count * ENTRY_BYTES
        if (length > available) {
            throw new Error(`Nikon event list declares ${count} events (${length} bytes) but has ${available} bytes`)
        }
        const events: NikonQueuedEvent[] = []
        for (let index = 0; index < count; index++) {
            const entry = COUNT_BYTES + index * ENTRY_BYTES
            events.push({ code: view.getUint16(entry, true), parameter: view.getUint32(entry + 2, true) })
        }
        return { value: events, bytesRead: length }
    }
}
