import { CustomCodec } from '@ptp/types/codec'

export interface CanonExtendedDeviceInfo {
    headerWord: number
    eventCodes: number[]
    propertyCodes: number[]
    /** Supported DS_REMOTE_MODE_T numbers; modes 4 and 8 are preserved without unverified labels. */
    remoteModes: number[]
    trailingByteCount: number
}

/**
 * Canon 0x9108: a preserved header word followed by three counted uint32 arrays.
 * https://github.com/gphoto/libgphoto2/blob/92171a382f185f617e95cb9acecf2d43688b19ab/camlibs/ptp2/ptp-pack.c#L342
 * The third array's SDK vector type is DS_REMOTE_MODE_T, established by REA evidence
 * ev_65ce80d48d4e9d8e7b3c168395988d8826e0e32b0ab92eb4d3deeb2e6d7ab857.
 */
export class CanonExtendedDeviceInfoDatasetCodec extends CustomCodec<CanonExtendedDeviceInfo> {
    encode(): Uint8Array {
        throw new Error('Canon extended device information is read only')
    }

    decode(buffer: Uint8Array, offset = 0): { value: CanonExtendedDeviceInfo; bytesRead: number } {
        if (!Number.isInteger(offset) || offset < 0 || offset > buffer.length) {
            throw new Error('Invalid Canon extended device information offset')
        }
        if (buffer.length - offset < 4) throw new Error('Truncated Canon extended device information header')

        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const headerWord = view.getUint32(offset, true)
        let position = offset + 4
        const readCodes = (field: string): number[] => {
            if (buffer.length - position < 4) {
                throw new Error(`Truncated Canon extended device information ${field} count`)
            }
            const count = view.getUint32(position, true)
            position += 4
            if (count > Math.floor((buffer.length - position) / 4)) {
                throw new Error(`Truncated Canon extended device information ${field} array`)
            }
            const codes = Array.from({ length: count }, (_, index) => view.getUint32(position + index * 4, true))
            position += count * 4
            return codes
        }
        const eventCodes = readCodes('events')
        const propertyCodes = readCodes('properties')
        const remoteModes = readCodes('remote modes')
        return {
            value: { headerWord, eventCodes, propertyCodes, remoteModes, trailingByteCount: buffer.length - position },
            bytesRead: position - offset,
        }
    }
}
