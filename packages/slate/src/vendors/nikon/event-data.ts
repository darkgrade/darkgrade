import { CustomCodec } from '@ptp/types/codec'

/** Nikon GetEventEx records carry a count for each event's UINT32 parameter words. */
export interface NikonQueuedEvent {
    code: number
    parameters: number[]
}

/**
 * Z6III SDK command reference rev 2, section 6.2.2.13: UINT32 record count, then
 * UINT16 event code, UINT16 parameter count and UINT32 parameters per record.
 * This framing is distinct from the older 0x90c7 GetEvent response.
 */
export class NikonEventDataCodec extends CustomCodec<NikonQueuedEvent[]> {
    encode(events: NikonQueuedEvent[]): Uint8Array {
        const length = events.reduce((total, event) => total + 4 + event.parameters.length * 4, 4)
        const data = new Uint8Array(length)
        const view = new DataView(data.buffer)
        view.setUint32(0, events.length, true)
        let offset = 4
        for (const event of events) {
            if (
                !Number.isInteger(event.code) ||
                event.code < 0 ||
                event.code > 0xffff ||
                event.parameters.length > 0xffff
            )
                throw new Error('Invalid Nikon event code or parameter count')
            view.setUint16(offset, event.code, true)
            view.setUint16(offset + 2, event.parameters.length, true)
            offset += 4
            for (const value of event.parameters) {
                if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
                    throw new Error('Invalid Nikon event parameter')
                view.setUint32(offset, value, true)
                offset += 4
            }
        }
        return data
    }

    decode(data: Uint8Array, offset = 0): { value: NikonQueuedEvent[]; bytesRead: number } {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        if (!Number.isInteger(offset) || offset < 0 || offset + 4 > data.length)
            throw new Error('Truncated Nikon event count')
        const count = view.getUint32(offset, true)
        if (count > Math.floor((data.length - offset - 4) / 4)) throw new Error('Truncated Nikon event records')
        const events: NikonQueuedEvent[] = []
        let position = offset + 4
        for (let index = 0; index < count; index += 1) {
            if (position + 4 > data.length) throw new Error('Truncated Nikon event header')
            const code = view.getUint16(position, true)
            const parametersCount = view.getUint16(position + 2, true)
            position += 4
            if (parametersCount > Math.floor((data.length - position) / 4))
                throw new Error('Truncated Nikon event parameters')
            const parameters: number[] = []
            for (let parameter = 0; parameter < parametersCount; parameter += 1) {
                parameters.push(view.getUint32(position, true))
                position += 4
            }
            events.push({ code, parameters })
        }
        if (position !== data.length) throw new Error('Unexpected bytes after Nikon event records')
        return { value: events, bytesRead: position - offset }
    }
}
