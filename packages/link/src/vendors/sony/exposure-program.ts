import { CustomCodec, type PTPRegistry } from '@ptp/types/codec'

// Native PTP values, not Camera Remote SDK property 261 values.
// Protocol reference: libgphoto2 config.c, 02d92fea8a269eb94330a4eade204ba799433606.
// Actual FX2 descriptor: UINT32, 0x00078090. Older bodies also advertise UINT16.
const modes: Record<number, string> = {
    0x00000001: 'Manual',
    0x00010002: 'Program Auto',
    0x00020003: 'Aperture Priority',
    0x00030004: 'Shutter Priority',
    0x00000005: 'Program Creative',
    0x00000006: 'Program Action',
    0x00000007: 'Portrait',
    0x00048000: 'Auto',
    0x00048001: 'Auto Plus',
    0x00078050: 'Movie Program Auto',
    0x00078051: 'Movie Aperture Priority',
    0x00078052: 'Movie Shutter Priority',
    0x00078053: 'Movie Manual',
    0x00078054: 'Movie Scene',
    0x000a8088: 'Movie',
    0x000a8089: 'Still',
    0x000b808a: 'Movie / S&Q Flexible Exposure',
    0x00078090: 'Movie Flexible Exposure',
    0x00098091: 'S&Q Flexible Exposure',
    0x000c8092: 'Interval Movie Flexible Exposure',
    0x000c8093: 'Interval Movie Program Auto',
    0x000c8094: 'Interval Movie Aperture Priority',
    0x000c8095: 'Interval Movie Shutter Priority',
    0x000c8096: 'Interval Movie Manual',
    0x000c8097: 'Interval Movie Auto',
}

/** Preserve the descriptor's width and every vendor bit, including unknown modes. */
export class SonyExposureProgramCodec extends CustomCodec<string> {
    constructor(registry: PTPRegistry, private datatype: number) {
        super(registry)
        if (datatype !== 0x0004 && datatype !== 0x0006)
            throw new Error(`Unsupported Sony exposure-mode datatype 0x${datatype.toString(16)}`)
    }
    private get valueCodec() {
        return this.datatype === 0x0006 ? this.registry.codecs.uint32 : this.registry.codecs.uint16
    }
    private entries() {
        return Object.entries(modes).map(([raw, name]) =>
            [this.datatype === 0x0006 ? Number(raw) : Number(raw) & 0xffff, name] as const)
    }
    encode(value: string): Uint8Array {
        const named = this.entries().find(([, name]) => name.toLowerCase() === value.trim().toLowerCase())
        const hexadecimal = /^Mode 0x([0-9a-f]{1,8})$/i.exec(value.trim())
        const raw = named?.[0] ?? (hexadecimal ? Number.parseInt(hexadecimal[1]!, 16) : NaN)
        const maximum = this.datatype === 0x0006 ? 0xffffffff : 0xffff
        if (!Number.isInteger(raw) || raw < 0 || raw > maximum)
            throw new Error(`Unknown or out-of-range Sony exposure mode: ${value}`)
        return this.valueCodec.encode(raw)
    }
    decode(buffer: Uint8Array, offset = 0) {
        const decoded = this.valueCodec.decode(buffer, offset)
        const name = this.entries().find(([raw]) => raw === decoded.value)?.[1]
        return { value: name ?? `Mode 0x${decoded.value.toString(16)}`, bytesRead: decoded.bytesRead }
    }
}
