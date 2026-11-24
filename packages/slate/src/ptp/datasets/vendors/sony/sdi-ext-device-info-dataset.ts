import { CustomCodec } from '@ptp/types/codec'

export interface SonyExtendedDeviceInfo {
    /** The camera's SDIO protocol version in hundredths: 300 is 3.00, 200 is 2.00. */
    protocolVersion: number
    propertyCodes: number[]
    controlCodes: number[]
}

/**
 * Sony 0x9202: a UINT16 protocol version followed by counted UINT16 property codes and control
 * codes. Either array may be absent (older bodies end after the property codes); a partly
 * present array is truncated and rejected. Same layout `profile-capture.ts` checks for 0x9202.
 */
export class SonyExtendedDeviceInfoCodec extends CustomCodec<SonyExtendedDeviceInfo> {
    encode(): Uint8Array {
        throw new Error('Sony extended device information is read only')
    }

    decode(buffer: Uint8Array, offset = 0): { value: SonyExtendedDeviceInfo; bytesRead: number } {
        if (!Number.isInteger(offset) || offset < 0 || offset > buffer.length) {
            throw new Error('Invalid Sony extended device information offset')
        }
        if (buffer.length - offset < 2) throw new Error('Truncated Sony extended device information version')
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
        const protocolVersion = view.getUint16(offset, true)
        let position = offset + 2
        const readCodes = (field: string): number[] => {
            if (position === buffer.length) return []
            if (buffer.length - position < 4) throw new Error(`Truncated Sony extended device information ${field} count`)
            const count = view.getUint32(position, true)
            position += 4
            if (count > Math.floor((buffer.length - position) / 2)) {
                throw new Error(`Truncated Sony extended device information ${field} array`)
            }
            const codes = Array.from({ length: count }, (_, index) => view.getUint16(position + index * 2, true))
            position += count * 2
            return codes
        }
        const propertyCodes = readCodes('property')
        const controlCodes = readCodes('control')
        return { value: { protocolVersion, propertyCodes, controlCodes }, bytesRead: position - offset }
    }
}
