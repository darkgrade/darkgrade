import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { baseCodecs, createEnumCodec, CustomCodec, EnumCodec, PTPRegistry } from '@ptp/types/codec'
import { PropertyDefinition } from '@ptp/types/property'

const UNDEF = getDatatypeByName('UNDEF')!.code
const UINT8 = getDatatypeByName('UINT8')!.code
const UINT16 = getDatatypeByName('UINT16')!.code
const INT16 = getDatatypeByName('INT16')!.code
const UINT32 = getDatatypeByName('UINT32')!.code
const STRING = getDatatypeByName('STR')!.code

const parseAperture = (v: string | number): number => {
    const s = String(v)
        .toLowerCase()
        .replace(/[fƒ]/g, '')
        .replace(/[\/:\s]/g, '')
    return parseFloat(s) || 0
}

const parseISO = (v: string | number): number => {
    const s = String(v)
        .toLowerCase()
        .replace(/iso\s*/g, '')
    if (s === 'auto') return 0xffffff
    return parseInt(s) || 0
}

const parseShutter = (v: string): [number, number] => {
    let s = String(v).toLowerCase().trim()
    if (s === 'bulb' || s === 'b') return [0, 0]

    s = s.replace(/["'`]/g, '').replace(/\s*(sec(onds?)?|s)\s*$/g, '')

    if (s.includes('/')) {
        const parts = s.split('/')
        const n = parseInt(parts[0] || '1') || 1
        const d = parseInt(parts[1] || '1') || 1
        return [n, d]
    }

    const num = parseFloat(s)
    if (isNaN(num)) return [1, 1]

    if (num >= 0.4) {
        return [Math.round(num * 10), 10]
    } else {
        const denominator = Math.round(1 / num)
        return [1, denominator]
    }
}

class ApertureCodec extends CustomCodec<string> {
    encode(value: string): Uint8Array {
        const v = String(value).toLowerCase()
        const u16 = this.baseCodecs.uint16
        if (v === 'iris close') return u16.encode(0xfffd)
        if (v === '--') return u16.encode(0xfffe)
        if (v === 'nothing to display') return u16.encode(0xffff)
        return u16.encode(Math.round(parseAperture(value) * 100))
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        const u16 = this.baseCodecs.uint16
        const result = u16.decode(buffer, offset)
        const hexValue = result.value

        const decoded =
            hexValue === 0xfffd
                ? 'Iris Close'
                : hexValue === 0xfffe
                  ? '--'
                  : hexValue === 0xffff
                    ? 'nothing to display'
                    : `f/${hexValue / 100}`

        return { value: decoded, bytesRead: result.bytesRead }
    }
}

class ShutterSpeedCodec extends CustomCodec<string> {
    encode(value: string): Uint8Array {
        const [n, d] = parseShutter(value)
        const u32 = this.baseCodecs.uint32
        if (n === 0 && d === 0) return u32.encode(0x00000000)
        return u32.encode((n << 16) | d)
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        const u32 = this.baseCodecs.uint32
        const result = u32.decode(buffer, offset)
        const hexValue = result.value

        if (hexValue === 0x00000000) {
            return { value: 'BULB', bytesRead: result.bytesRead }
        }

        const numerator = (hexValue >> 16) & 0xffff
        const denominator = hexValue & 0xffff

        let decoded: string
        if (numerator === 1) {
            decoded = `1/${denominator}`
        } else if (denominator === 0x000a) {
            const seconds = numerator / 10
            if (seconds === Math.floor(seconds)) {
                decoded = `${Math.floor(seconds)}"`
            } else {
                decoded = `${seconds}"`
            }
        } else {
            decoded = `${numerator}/${denominator}`
        }

        return { value: decoded, bytesRead: result.bytesRead }
    }
}

class IsoCodec extends CustomCodec<string> {
    encode(value: string): Uint8Array {
        const v = String(value).toLowerCase()
        const isoValue = parseISO(value)
        const u32 = this.baseCodecs.uint32
        if (isoValue === 0xffffff || v.includes('auto')) return u32.encode(0x00ffffff)
        const modePrefix = v.includes('multi frame nr high')
            ? 0x02000000
            : v.includes('multi frame nr')
              ? 0x01000000
              : 0x00000000
        return u32.encode(modePrefix | isoValue)
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        const u32 = this.baseCodecs.uint32
        const result = u32.decode(buffer, offset)
        const hexValue = result.value

        if (hexValue === 0x00ffffff) {
            return { value: 'ISO AUTO', bytesRead: result.bytesRead }
        }

        const modePrefix = hexValue & 0xff000000
        const isoValue = hexValue & 0x00ffffff

        const decoded =
            modePrefix === 0x00000000
                ? `ISO ${isoValue}`
                : modePrefix === 0x01000000
                  ? `Multi Frame NR ISO ${isoValue}`
                  : modePrefix === 0x02000000
                    ? `Multi Frame NR High ISO ${isoValue}`
                    : `Unknown ISO mode: 0x${hexValue.toString(16).padStart(8, '0')}`

        return { value: decoded, bytesRead: result.bytesRead }
    }
}

class ExposureValueCodec extends CustomCodec<string> {
    encode(value: string): Uint8Array {
        const i16 = this.baseCodecs.int16
        return i16.encode(Math.round(parseFloat(value) * 1000))
    }

    decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
        const i16 = this.baseCodecs.int16
        const result = i16.decode(buffer, offset)
        const decoded = result.value / 1000
        return { value: `${decoded < 0 ? '-' : '+'}${Math.abs(decoded)} EV`, bytesRead: result.bytesRead }
    }
}

export const Aperture = {
    code: 0x5007,
    name: 'Aperture',
    description: 'Get/Set the aperture value.',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry => new ApertureCodec(registry),
} as const satisfies PropertyDefinition

export const ShutterSpeed = {
    code: 0xd20d,
    name: 'ShutterSpeed',
    description: 'Get/Set the shutter speed.',
    datatype: UINT32,
    access: 'GetSet',
    codec: registry => new ShutterSpeedCodec(registry),
} as const satisfies PropertyDefinition

export const Iso = {
    code: 0xd21e,
    name: 'Iso',
    description: 'Get/Set the ISO sensitivity.',
    datatype: UINT32,
    access: 'GetSet',
    codec: registry => new IsoCodec(registry),
} as const satisfies PropertyDefinition

export const Exposure = {
    code: 0x0000,
    name: 'Exposure',
    description: 'Exposure (either metered or manually set)',
    datatype: INT16,
    access: 'Get',
    codec: baseCodecs.int16,
} as const satisfies PropertyDefinition

export const MeteredExposure = {
    code: 0xd1b5,
    name: 'MeteredExposure',
    description: 'AKA Metered Manual Level - Get the metered manual level.',
    datatype: INT16,
    access: 'GetSet',
    codec: registry => new ExposureValueCodec(registry),
} as const satisfies PropertyDefinition

export const ExposureCompensation = {
    code: 0x5010,
    name: 'ExposureCompensation',
    description: 'AKA Exposure Bias Compensation - Get/Set the exposure bias compensation.',
    datatype: INT16,
    access: 'GetSet',
    codec: registry => new ExposureValueCodec(registry),
} as const satisfies PropertyDefinition

export const StillCaptureMode = {
    code: 0x5013,
    name: 'StillCaptureMode',
    description: 'Get/Set the drive mode.',
    datatype: UINT32,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x00000001, name: 'Normal', description: 'Normal' },
                { value: 0x00010002, name: 'Continuous Shooting Hi', description: 'Continuous Shooting Hi' },
                { value: 0x00018010, name: 'Continuous Shooting Hi+', description: 'Continuous Shooting Hi+' },
                { value: 0x00018011, name: 'Continuous Shooting Hi-Live', description: 'Continuous Shooting Hi-Live' },
                { value: 0x00018012, name: 'Continuous Shooting Lo', description: 'Continuous Shooting Lo' },
                { value: 0x00018013, name: 'Continuous Shooting', description: 'Continuous Shooting' },
                {
                    value: 0x00018014,
                    name: 'Continuous Shooting Speed Priority',
                    description: 'Continuous Shooting Speed Priority',
                },
                { value: 0x00018015, name: 'Continuous Shooting Mid', description: 'Continuous Shooting Mid' },
                {
                    value: 0x00018016,
                    name: 'Continuous Shooting Mid-Live',
                    description: 'Continuous Shooting Mid-Live',
                },
                { value: 0x00018017, name: 'Continuous Shooting Lo-Live', description: 'Continuous Shooting Lo-Live' },
                { value: 0x00020003, name: 'Timelapse', description: 'Timelapse' },
                { value: 0x00038003, name: 'Self Timer 5 Sec.', description: 'Self Timer 5 Sec.' },
                { value: 0x00038004, name: 'Self Timer 10 Sec.', description: 'Self Timer 10 Sec.' },
                { value: 0x00038005, name: 'Self Timer 2 Sec.', description: 'Self Timer 2 Sec.' },
                {
                    value: 0x0004c237,
                    name: 'Continuous Bracket 0.3 EV 2 Img. +',
                    description: 'Continuous Bracket 0.3 EV 2 Img. +',
                },
                {
                    value: 0x0004c23f,
                    name: 'Continuous Bracket 0.3 EV 2 Img. -',
                    description: 'Continuous Bracket 0.3 EV 2 Img. -',
                },
                {
                    value: 0x00048337,
                    name: 'Continuous Bracket 0.3 EV 3 Img.',
                    description: 'Continuous Bracket 0.3 EV 3 Img.',
                },
                {
                    value: 0x00048537,
                    name: 'Continuous Bracket 0.3 EV 5 Img.',
                    description: 'Continuous Bracket 0.3 EV 5 Img.',
                },
                {
                    value: 0x00048737,
                    name: 'Continuous Bracket 0.3 EV 7 Img.',
                    description: 'Continuous Bracket 0.3 EV 7 Img.',
                },
                {
                    value: 0x00048937,
                    name: 'Continuous Bracket 0.3 EV 9 Img.',
                    description: 'Continuous Bracket 0.3 EV 9 Img.',
                },
                {
                    value: 0x0004c257,
                    name: 'Continuous Bracket 0.5 EV 2 Img. +',
                    description: 'Continuous Bracket 0.5 EV 2 Img. +',
                },
                {
                    value: 0x0004c25f,
                    name: 'Continuous Bracket 0.5 EV 2 Img. -',
                    description: 'Continuous Bracket 0.5 EV 2 Img. -',
                },
                {
                    value: 0x00048357,
                    name: 'Continuous Bracket 0.5 EV 3 Img.',
                    description: 'Continuous Bracket 0.5 EV 3 Img.',
                },
                {
                    value: 0x00048557,
                    name: 'Continuous Bracket 0.5 EV 5 Img.',
                    description: 'Continuous Bracket 0.5 EV 5 Img.',
                },
                {
                    value: 0x00048757,
                    name: 'Continuous Bracket 0.5 EV 7 Img.',
                    description: 'Continuous Bracket 0.5 EV 7 Img.',
                },
                {
                    value: 0x00048957,
                    name: 'Continuous Bracket 0.5 EV 9 Img.',
                    description: 'Continuous Bracket 0.5 EV 9 Img.',
                },
                {
                    value: 0x0004c277,
                    name: 'Continuous Bracket 0.7 EV 2 Img. +',
                    description: 'Continuous Bracket 0.7 EV 2 Img. +',
                },
                {
                    value: 0x0004c27f,
                    name: 'Continuous Bracket 0.7 EV 2 Img. -',
                    description: 'Continuous Bracket 0.7 EV 2 Img. -',
                },
                {
                    value: 0x00048377,
                    name: 'Continuous Bracket 0.7 EV 3 Img.',
                    description: 'Continuous Bracket 0.7 EV 3 Img.',
                },
                {
                    value: 0x00048577,
                    name: 'Continuous Bracket 0.7 EV 5 Img.',
                    description: 'Continuous Bracket 0.7 EV 5 Img.',
                },
                {
                    value: 0x00048777,
                    name: 'Continuous Bracket 0.7 EV 7 Img.',
                    description: 'Continuous Bracket 0.7 EV 7 Img.',
                },
                {
                    value: 0x00048977,
                    name: 'Continuous Bracket 0.7 EV 9 Img.',
                    description: 'Continuous Bracket 0.7 EV 9 Img.',
                },
                {
                    value: 0x0004c211,
                    name: 'Continuous Bracket 1.0 EV 2 Img. +',
                    description: 'Continuous Bracket 1.0 EV 2 Img. +',
                },
                {
                    value: 0x0004c219,
                    name: 'Continuous Bracket 1.0 EV 2 Img. -',
                    description: 'Continuous Bracket 1.0 EV 2 Img. -',
                },
                {
                    value: 0x00048311,
                    name: 'Continuous Bracket 1.0 EV 3 Img.',
                    description: 'Continuous Bracket 1.0 EV 3 Img.',
                },
                {
                    value: 0x00048511,
                    name: 'Continuous Bracket 1.0 EV 5 Img.',
                    description: 'Continuous Bracket 1.0 EV 5 Img.',
                },
                {
                    value: 0x00048711,
                    name: 'Continuous Bracket 1.0 EV 7 Img.',
                    description: 'Continuous Bracket 1.0 EV 7 Img.',
                },
                {
                    value: 0x00048911,
                    name: 'Continuous Bracket 1.0 EV 9 Img.',
                    description: 'Continuous Bracket 1.0 EV 9 Img.',
                },
                {
                    value: 0x0004c241,
                    name: 'Continuous Bracket 1.3 EV 2 Img. +',
                    description: 'Continuous Bracket 1.3 EV 2 Img. +',
                },
                {
                    value: 0x0004c249,
                    name: 'Continuous Bracket 1.3 EV 2 Img. -',
                    description: 'Continuous Bracket 1.3 EV 2 Img. -',
                },
                {
                    value: 0x00048341,
                    name: 'Continuous Bracket 1.3 EV 3 Img.',
                    description: 'Continuous Bracket 1.3 EV 3 Img.',
                },
                {
                    value: 0x00048541,
                    name: 'Continuous Bracket 1.3 EV 5 Img.',
                    description: 'Continuous Bracket 1.3 EV 5 Img.',
                },
                {
                    value: 0x00048741,
                    name: 'Continuous Bracket 1.3 EV 7 Img.',
                    description: 'Continuous Bracket 1.3 EV 7 Img.',
                },
                {
                    value: 0x0004c261,
                    name: 'Continuous Bracket 1.5 EV 2 Img. +',
                    description: 'Continuous Bracket 1.5 EV 2 Img. +',
                },
                {
                    value: 0x0004c269,
                    name: 'Continuous Bracket 1.5 EV 2 Img. -',
                    description: 'Continuous Bracket 1.5 EV 2 Img. -',
                },
                {
                    value: 0x00048361,
                    name: 'Continuous Bracket 1.5 EV 3 Img.',
                    description: 'Continuous Bracket 1.5 EV 3 Img.',
                },
                {
                    value: 0x00048561,
                    name: 'Continuous Bracket 1.5 EV 5 Img.',
                    description: 'Continuous Bracket 1.5 EV 5 Img.',
                },
                {
                    value: 0x00048761,
                    name: 'Continuous Bracket 1.5 EV 7 Img.',
                    description: 'Continuous Bracket 1.5 EV 7 Img.',
                },
                {
                    value: 0x0004c281,
                    name: 'Continuous Bracket 1.7 EV 2 Img. +',
                    description: 'Continuous Bracket 1.7 EV 2 Img. +',
                },
                {
                    value: 0x0004c289,
                    name: 'Continuous Bracket 1.7 EV 2 Img. -',
                    description: 'Continuous Bracket 1.7 EV 2 Img. -',
                },
                {
                    value: 0x00048381,
                    name: 'Continuous Bracket 1.7 EV 3 Img.',
                    description: 'Continuous Bracket 1.7 EV 3 Img.',
                },
                {
                    value: 0x00048581,
                    name: 'Continuous Bracket 1.7 EV 5 Img.',
                    description: 'Continuous Bracket 1.7 EV 5 Img.',
                },
                {
                    value: 0x00048781,
                    name: 'Continuous Bracket 1.7 EV 7 Img.',
                    description: 'Continuous Bracket 1.7 EV 7 Img.',
                },
                {
                    value: 0x0004c221,
                    name: 'Continuous Bracket 2.0 EV 2 Img. +',
                    description: 'Continuous Bracket 2.0 EV 2 Img. +',
                },
                {
                    value: 0x0004c229,
                    name: 'Continuous Bracket 2.0 EV 2 Img. -',
                    description: 'Continuous Bracket 2.0 EV 2 Img. -',
                },
                {
                    value: 0x00048321,
                    name: 'Continuous Bracket 2.0 EV 3 Img.',
                    description: 'Continuous Bracket 2.0 EV 3 Img.',
                },
                {
                    value: 0x00048521,
                    name: 'Continuous Bracket 2.0 EV 5 Img.',
                    description: 'Continuous Bracket 2.0 EV 5 Img.',
                },
                {
                    value: 0x00048721,
                    name: 'Continuous Bracket 2.0 EV 7 Img.',
                    description: 'Continuous Bracket 2.0 EV 7 Img.',
                },
                {
                    value: 0x0004c251,
                    name: 'Continuous Bracket 2.3 EV 2 Img. +',
                    description: 'Continuous Bracket 2.3 EV 2 Img. +',
                },
                {
                    value: 0x0004c259,
                    name: 'Continuous Bracket 2.3 EV 2 Img. -',
                    description: 'Continuous Bracket 2.3 EV 2 Img. -',
                },
                {
                    value: 0x00048351,
                    name: 'Continuous Bracket 2.3 EV 3 Img.',
                    description: 'Continuous Bracket 2.3 EV 3 Img.',
                },
                {
                    value: 0x00048551,
                    name: 'Continuous Bracket 2.3 EV 5 Img.',
                    description: 'Continuous Bracket 2.3 EV 5 Img.',
                },
                {
                    value: 0x0004c271,
                    name: 'Continuous Bracket 2.5 EV 2 Img. +',
                    description: 'Continuous Bracket 2.5 EV 2 Img. +',
                },
                {
                    value: 0x0004c279,
                    name: 'Continuous Bracket 2.5 EV 2 Img. -',
                    description: 'Continuous Bracket 2.5 EV 2 Img. -',
                },
                {
                    value: 0x00048371,
                    name: 'Continuous Bracket 2.5 EV 3 Img.',
                    description: 'Continuous Bracket 2.5 EV 3 Img.',
                },
                {
                    value: 0x00048571,
                    name: 'Continuous Bracket 2.5 EV 5 Img.',
                    description: 'Continuous Bracket 2.5 EV 5 Img.',
                },
                {
                    value: 0x0004c291,
                    name: 'Continuous Bracket 2.7 EV 2 Img. +',
                    description: 'Continuous Bracket 2.7 EV 2 Img. +',
                },
                {
                    value: 0x0004c299,
                    name: 'Continuous Bracket 2.7 EV 2 Img. -',
                    description: 'Continuous Bracket 2.7 EV 2 Img. -',
                },
                {
                    value: 0x00048391,
                    name: 'Continuous Bracket 2.7 EV 3 Img.',
                    description: 'Continuous Bracket 2.7 EV 3 Img.',
                },
                {
                    value: 0x00048591,
                    name: 'Continuous Bracket 2.7 EV 5 Img.',
                    description: 'Continuous Bracket 2.7 EV 5 Img.',
                },
                {
                    value: 0x0004c231,
                    name: 'Continuous Bracket 3.0 EV 2 Img. +',
                    description: 'Continuous Bracket 3.0 EV 2 Img. +',
                },
                {
                    value: 0x0004c239,
                    name: 'Continuous Bracket 3.0 EV 2 Img. -',
                    description: 'Continuous Bracket 3.0 EV 2 Img. -',
                },
                {
                    value: 0x00048331,
                    name: 'Continuous Bracket 3.0 EV 3 Img.',
                    description: 'Continuous Bracket 3.0 EV 3 Img.',
                },
                {
                    value: 0x00048531,
                    name: 'Continuous Bracket 3.0 EV 5 Img.',
                    description: 'Continuous Bracket 3.0 EV 5 Img.',
                },
                {
                    value: 0x0005c236,
                    name: 'Single Bracket 0.3 EV 2 Img. +',
                    description: 'Single Bracket 0.3 EV 2 Img. +',
                },
                {
                    value: 0x0005c23e,
                    name: 'Single Bracket 0.3 EV 2 Img. -',
                    description: 'Single Bracket 0.3 EV 2 Img. -',
                },
                {
                    value: 0x00058336,
                    name: 'Single Bracket 0.3 EV 3 Img.',
                    description: 'Single Bracket 0.3 EV 3 Img.',
                },
                {
                    value: 0x00058536,
                    name: 'Single Bracket 0.3 EV 5 Img.',
                    description: 'Single Bracket 0.3 EV 5 Img.',
                },
                {
                    value: 0x00058736,
                    name: 'Single Bracket 0.3 EV 7 Img.',
                    description: 'Single Bracket 0.3 EV 7 Img.',
                },
                {
                    value: 0x00058936,
                    name: 'Single Bracket 0.3 EV 9 Img.',
                    description: 'Single Bracket 0.3 EV 9 Img.',
                },
                {
                    value: 0x0005c256,
                    name: 'Single Bracket 0.5 EV 2 Img. +',
                    description: 'Single Bracket 0.5 EV 2 Img. +',
                },
                {
                    value: 0x0005c25e,
                    name: 'Single Bracket 0.5 EV 2 Img. -',
                    description: 'Single Bracket 0.5 EV 2 Img. -',
                },
                {
                    value: 0x00058356,
                    name: 'Single Bracket 0.5 EV 3 Img.',
                    description: 'Single Bracket 0.5 EV 3 Img.',
                },
                {
                    value: 0x00058556,
                    name: 'Single Bracket 0.5 EV 5 Img.',
                    description: 'Single Bracket 0.5 EV 5 Img.',
                },
                {
                    value: 0x00058756,
                    name: 'Single Bracket 0.5 EV 7 Img.',
                    description: 'Single Bracket 0.5 EV 7 Img.',
                },
                {
                    value: 0x00058956,
                    name: 'Single Bracket 0.5 EV 9 Img.',
                    description: 'Single Bracket 0.5 EV 9 Img.',
                },
                {
                    value: 0x0005c276,
                    name: 'Single Bracket 0.7 EV 2 Img. +',
                    description: 'Single Bracket 0.7 EV 2 Img. +',
                },
                {
                    value: 0x0005c27e,
                    name: 'Single Bracket 0.7 EV 2 Img. -',
                    description: 'Single Bracket 0.7 EV 2 Img. -',
                },
                {
                    value: 0x00058376,
                    name: 'Single Bracket 0.7 EV 3 Img.',
                    description: 'Single Bracket 0.7 EV 3 Img.',
                },
                {
                    value: 0x00058576,
                    name: 'Single Bracket 0.7 EV 5 Img.',
                    description: 'Single Bracket 0.7 EV 5 Img.',
                },
                {
                    value: 0x00058776,
                    name: 'Single Bracket 0.7 EV 7 Img.',
                    description: 'Single Bracket 0.7 EV 7 Img.',
                },
                {
                    value: 0x00058976,
                    name: 'Single Bracket 0.7 EV 9 Img.',
                    description: 'Single Bracket 0.7 EV 9 Img.',
                },
                {
                    value: 0x0005c210,
                    name: 'Single Bracket 1.0 EV 2 Img. +',
                    description: 'Single Bracket 1.0 EV 2 Img. +',
                },
                {
                    value: 0x0005c218,
                    name: 'Single Bracket 1.0 EV 2 Img. -',
                    description: 'Single Bracket 1.0 EV 2 Img. -',
                },
                {
                    value: 0x00058310,
                    name: 'Single Bracket 1.0 EV 3 Img.',
                    description: 'Single Bracket 1.0 EV 3 Img.',
                },
                {
                    value: 0x00058510,
                    name: 'Single Bracket 1.0 EV 5 Img.',
                    description: 'Single Bracket 1.0 EV 5 Img.',
                },
                {
                    value: 0x00058710,
                    name: 'Single Bracket 1.0 EV 7 Img.',
                    description: 'Single Bracket 1.0 EV 7 Img.',
                },
                {
                    value: 0x00058910,
                    name: 'Single Bracket 1.0 EV 9 Img.',
                    description: 'Single Bracket 1.0 EV 9 Img.',
                },
                {
                    value: 0x0005c240,
                    name: 'Single Bracket 1.3 EV 2 Img. +',
                    description: 'Single Bracket 1.3 EV 2 Img. +',
                },
                {
                    value: 0x0005c248,
                    name: 'Single Bracket 1.3 EV 2 Img. -',
                    description: 'Single Bracket 1.3 EV 2 Img. -',
                },
                {
                    value: 0x00058340,
                    name: 'Single Bracket 1.3 EV 3 Img.',
                    description: 'Single Bracket 1.3 EV 3 Img.',
                },
                {
                    value: 0x00058540,
                    name: 'Single Bracket 1.3 EV 5 Img.',
                    description: 'Single Bracket 1.3 EV 5 Img.',
                },
                {
                    value: 0x00058740,
                    name: 'Single Bracket 1.3 EV 7 Img.',
                    description: 'Single Bracket 1.3 EV 7 Img.',
                },
                {
                    value: 0x0005c260,
                    name: 'Single Bracket 1.5 EV 2 Img. +',
                    description: 'Single Bracket 1.5 EV 2 Img. +',
                },
                {
                    value: 0x0005c268,
                    name: 'Single Bracket 1.5 EV 2 Img. -',
                    description: 'Single Bracket 1.5 EV 2 Img. -',
                },
                {
                    value: 0x00058360,
                    name: 'Single Bracket 1.5 EV 3 Img.',
                    description: 'Single Bracket 1.5 EV 3 Img.',
                },
                {
                    value: 0x00058560,
                    name: 'Single Bracket 1.5 EV 5 Img.',
                    description: 'Single Bracket 1.5 EV 5 Img.',
                },
                {
                    value: 0x00058760,
                    name: 'Single Bracket 1.5 EV 7 Img.',
                    description: 'Single Bracket 1.5 EV 7 Img.',
                },
                {
                    value: 0x0005c280,
                    name: 'Single Bracket 1.7 EV 2 Img. +',
                    description: 'Single Bracket 1.7 EV 2 Img. +',
                },
                {
                    value: 0x0005c288,
                    name: 'Single Bracket 1.7 EV 2 Img. -',
                    description: 'Single Bracket 1.7 EV 2 Img. -',
                },
                {
                    value: 0x00058380,
                    name: 'Single Bracket 1.7 EV 3 Img.',
                    description: 'Single Bracket 1.7 EV 3 Img.',
                },
                {
                    value: 0x00058580,
                    name: 'Single Bracket 1.7 EV 5 Img.',
                    description: 'Single Bracket 1.7 EV 5 Img.',
                },
                {
                    value: 0x00058780,
                    name: 'Single Bracket 1.7 EV 7 Img.',
                    description: 'Single Bracket 1.7 EV 7 Img.',
                },
                {
                    value: 0x0005c220,
                    name: 'Single Bracket 2.0 EV 2 Img. +',
                    description: 'Single Bracket 2.0 EV 2 Img. +',
                },
                {
                    value: 0x0005c228,
                    name: 'Single Bracket 2.0 EV 2 Img. -',
                    description: 'Single Bracket 2.0 EV 2 Img. -',
                },
                {
                    value: 0x00058320,
                    name: 'Single Bracket 2.0 EV 3 Img.',
                    description: 'Single Bracket 2.0 EV 3 Img.',
                },
                {
                    value: 0x00058520,
                    name: 'Single Bracket 2.0 EV 5 Img.',
                    description: 'Single Bracket 2.0 EV 5 Img.',
                },
                {
                    value: 0x00058720,
                    name: 'Single Bracket 2.0 EV 7 Img.',
                    description: 'Single Bracket 2.0 EV 7 Img.',
                },
                {
                    value: 0x0005c250,
                    name: 'Single Bracket 2.3 EV 2 Img. +',
                    description: 'Single Bracket 2.3 EV 2 Img. +',
                },
                {
                    value: 0x0005c258,
                    name: 'Single Bracket 2.3 EV 2 Img. -',
                    description: 'Single Bracket 2.3 EV 2 Img. -',
                },
                {
                    value: 0x00058350,
                    name: 'Single Bracket 2.3 EV 3 Img.',
                    description: 'Single Bracket 2.3 EV 3 Img.',
                },
                {
                    value: 0x00058550,
                    name: 'Single Bracket 2.3 EV 5 Img.',
                    description: 'Single Bracket 2.3 EV 5 Img.',
                },
                {
                    value: 0x0005c270,
                    name: 'Single Bracket 2.5 EV 2 Img. +',
                    description: 'Single Bracket 2.5 EV 2 Img. +',
                },
                {
                    value: 0x0005c278,
                    name: 'Single Bracket 2.5 EV 2 Img. -',
                    description: 'Single Bracket 2.5 EV 2 Img. -',
                },
                {
                    value: 0x00058370,
                    name: 'Single Bracket 2.5 EV 3 Img.',
                    description: 'Single Bracket 2.5 EV 3 Img.',
                },
                {
                    value: 0x00058570,
                    name: 'Single Bracket 2.5 EV 5 Img.',
                    description: 'Single Bracket 2.5 EV 5 Img.',
                },
                {
                    value: 0x0005c290,
                    name: 'Single Bracket 2.7 EV 2 Img. +',
                    description: 'Single Bracket 2.7 EV 2 Img. +',
                },
                {
                    value: 0x0005c298,
                    name: 'Single Bracket 2.7 EV 2 Img. -',
                    description: 'Single Bracket 2.7 EV 2 Img. -',
                },
                {
                    value: 0x00058390,
                    name: 'Single Bracket 2.7 EV 3 Img.',
                    description: 'Single Bracket 2.7 EV 3 Img.',
                },
                {
                    value: 0x00058590,
                    name: 'Single Bracket 2.7 EV 5 Img.',
                    description: 'Single Bracket 2.7 EV 5 Img.',
                },
                {
                    value: 0x0005c230,
                    name: 'Single Bracket 3.0 EV 2 Img. +',
                    description: 'Single Bracket 3.0 EV 2 Img. +',
                },
                {
                    value: 0x0005c238,
                    name: 'Single Bracket 3.0 EV 2 Img. -',
                    description: 'Single Bracket 3.0 EV 2 Img. -',
                },
                {
                    value: 0x00058330,
                    name: 'Single Bracket 3.0 EV 3 Img.',
                    description: 'Single Bracket 3.0 EV 3 Img.',
                },
                {
                    value: 0x00058530,
                    name: 'Single Bracket 3.0 EV 5 Img.',
                    description: 'Single Bracket 3.0 EV 5 Img.',
                },
                { value: 0x00068018, name: 'White Balance Bracket Lo', description: 'White Balance Bracket Lo' },
                { value: 0x00068028, name: 'White Balance Bracket Hi', description: 'White Balance Bracket Hi' },
                { value: 0x00078019, name: 'DRO Bracket Lo', description: 'DRO Bracket Lo' },
                { value: 0x00078029, name: 'DRO Bracket Hi', description: 'DRO Bracket Hi' },
                { value: 0x0007801a, name: 'LPF Bracket', description: 'LPF Bracket' },
                { value: 0x0007800a, name: 'Remote Commander', description: 'Remote Commander' },
                { value: 0x0007800b, name: 'Mirror Up', description: 'Mirror Up' },
                { value: 0x00078006, name: 'Self Portrait 1 Person', description: 'Self Portrait 1 Person' },
                { value: 0x00078007, name: 'Self Portrait 2 People', description: 'Self Portrait 2 People' },
                {
                    value: 0x00088008,
                    name: 'Continuous Self Timer 3 Img.',
                    description: 'Continuous Self Timer 3 Img.',
                },
                {
                    value: 0x00088009,
                    name: 'Continuous Self Timer 5 Img.',
                    description: 'Continuous Self Timer 5 Img.',
                },
                {
                    value: 0x0008800c,
                    name: 'Continuous Self Timer 3 Img. 5 Sec.',
                    description: 'Continuous Self Timer 3 Img. 5 Sec.',
                },
                {
                    value: 0x0008800d,
                    name: 'Continuous Self Timer 5 Img. 5 Sec.',
                    description: 'Continuous Self Timer 5 Img. 5 Sec.',
                },
                {
                    value: 0x0008800e,
                    name: 'Continuous Self Timer 3 Img. 2 Sec.',
                    description: 'Continuous Self Timer 3 Img. 2 Sec.',
                },
                {
                    value: 0x0008800f,
                    name: 'Continuous Self Timer 5 Img. 2 Sec.',
                    description: 'Continuous Self Timer 5 Img. 2 Sec.',
                },
                { value: 0x00098030, name: 'Spot Burst Shooting Lo', description: 'Spot Burst Shooting Lo' },
                { value: 0x00098031, name: 'Spot Burst Shooting Mid', description: 'Spot Burst Shooting Mid' },
                { value: 0x00098032, name: 'Spot Burst Shooting Hi', description: 'Spot Burst Shooting Hi' },
                { value: 0x000a8040, name: 'Focus Bracket', description: 'Focus Bracket' },
            ],
            registry.codecs.uint32
        ),
} as const satisfies PropertyDefinition

export const OsdImageMode = {
    code: 0xd207,
    name: 'OsdImageMode',
    description: 'Get/Set the OSD image mode',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x00, name: 'OFF', description: 'OFF' },
                { value: 0x01, name: 'ON', description: 'ON' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const LiveViewStatus = {
    code: 0xd221,
    name: 'LiveViewStatus',
    description: 'Get the live view status.',
    datatype: UINT8,
    access: 'Get',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x00, name: 'SUPPORTED_DISABLED', description: 'SUPPORTED_DISABLED' },
                { value: 0x01, name: 'SUPPORTED_ENABLED', description: 'SUPPORTED_ENABLED' },
                { value: 0x02, name: 'NOT_SUPPORTED', description: 'NOT_SUPPORTED' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const StillImageSaveDestination = {
    code: 0xd222,
    name: 'StillImageSaveDestination',
    description: 'Get the information of still image save destination.',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x0001, name: 'CAMERA_DEVICE', description: 'CAMERA_DEVICE' },
                { value: 0x0010, name: 'HOST_DEVICE', description: 'HOST_DEVICE' },
                { value: 0x0011, name: 'BOTH_DEVICES', description: 'BOTH_DEVICES' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const PositionKeySetting = {
    code: 0xd25a,
    name: 'PositionKeySetting',
    description: 'Get/Set the position key setting (controls which setting takes priority between host and camera)',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x00, name: 'CAMERA_PRIORITY', description: 'CAMERA_PRIORITY' },
                { value: 0x01, name: 'HOST_PRIORITY', description: 'HOST_PRIORITY' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const SetLiveViewEnable = {
    code: 0xd313,
    name: 'SetLiveViewEnable',
    description:
        'Set live view enable. When using Live View while connected in "Remote Control with Transfer Mode," it is necessary to enable the feature using this Control Code.',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x0001, name: 'DISABLE', description: 'DISABLE' },
                { value: 0x0002, name: 'ENABLE', description: 'ENABLE' },
            ],
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const SetPostViewEnable = {
    code: 0xd312,
    name: 'SetPostViewEnable',
    description:
        'Set post view enable. When using Live View while connected in "Remote Control with Transfer Mode," it is necessary to enable the feature using this Control Code.',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x0001, name: 'DISABLE', description: 'DISABLE' },
                { value: 0x0002, name: 'ENABLE', description: 'ENABLE' },
            ],
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const ShootingFileInfo = {
    code: 0xd215,
    name: 'ShootingFileInfo',
    description: 'Get the shooting file info. 0x0000 indicates no files are available, 0x0001 - 0x7FFF indicate files exist. 0x8001 and over indicate the files are ready for transfer.',
    datatype: UINT16,
    access: 'Get',
    codec: baseCodecs.uint16,
} as const satisfies PropertyDefinition

export const ShutterHalfReleaseButton = {
    code: 0xd2c1,
    name: 'ShutterHalfReleaseButton',
    description: 'Control shutter half-release (S1) (focus) button.',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x0001, name: 'UP', description: 'UP' },
                { value: 0x0002, name: 'DOWN', description: 'DOWN' },
            ],
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const ShutterReleaseButton = {
    code: 0xd2c2,
    name: 'ShutterReleaseButton',
    description: 'Control shutter release (S2) button.',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x0001, name: 'UP', description: 'UP' },
                { value: 0x0002, name: 'DOWN', description: 'DOWN' },
            ],
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const S1S2Button = {
    code: 0xd2e6,
    name: 'S1S2Button',
    description: 'Execute shutter half-release (S1) and shutter release (S2) buttons.',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        createEnumCodec(
            registry,
            [
                { value: 0x0001, name: 'UP', description: 'UP' },
                { value: 0x0002, name: 'DOWN', description: 'DOWN' },
            ] as const,
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const MovieRecButton = {
    code: 0xd2c8,
    name: 'MovieRecButton',
    description: 'Control movie record button (hold)',
    datatype: UINT16,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x0001, name: 'UP', description: 'UP' },
                { value: 0x0002, name: 'DOWN', description: 'DOWN' },
            ],
            registry.codecs.uint16
        ),
} as const satisfies PropertyDefinition

export const LiveViewImageQuality = {
    code: 0xd26a,
    name: 'LiveViewImageQuality',
    description: 'Get/Set the live view image quality.',
    datatype: UINT8,
    access: 'GetSet',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x01, name: 'LOW', description: 'LOW' },
                { value: 0x02, name: 'HIGH', description: 'HIGH' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const ContentTransferEnable = {
    code: 0xd295,
    name: 'ContentTransferEnable',
    description: 'Get the contents transfer enabled status.',
    datatype: UINT8,
    access: 'Get',
    codec: registry =>
        new EnumCodec(
            registry,
            [
                { value: 0x00, name: 'DISABLE', description: 'DISABLE' },
                { value: 0x01, name: 'ENABLE', description: 'ENABLE' },
            ],
            registry.codecs.uint8
        ),
} as const satisfies PropertyDefinition

export const FocusIndicationCodec = (registry: PTPRegistry) =>
    createEnumCodec(
        registry,
        [
            { value: 0x01, name: 'UNLOCK', description: 'Unlock' },
            { value: 0x02, name: 'AF_S_FOCUSED', description: '[AF-S] Focused and AF Locked State' },
            { value: 0x03, name: 'AF_S_NOT_FOCUSED', description: '[AF-S] Not Focused and Low Contrast State' },
            { value: 0x04, name: 'NOT_USED', description: 'Not Used' },
            { value: 0x05, name: 'AF_C_TRACKING', description: '[AF-C] Tracking Subject motion' },
            { value: 0x06, name: 'AF_C_FOCUSED', description: '[AF-C] Focused State' },
            { value: 0x07, name: 'AF_C_NOT_FOCUSED', description: '[AF-C] Not Focused and Low Contrast State' },
            { value: 0x08, name: 'UNPAUSE', description: 'Unpause' },
            { value: 0x09, name: 'PAUSE', description: 'Pause' },
        ] as const,
        registry.codecs.uint8
    )

export const FocusIndication = {
    code: 0xd213,
    name: 'FocusIndication',
    description: 'Get the focus indication.',
    datatype: UINT8,
    access: 'Get',
    codec: FocusIndicationCodec,
} as const satisfies PropertyDefinition

export const sonyPropertyRegistry = {
    Aperture,
    ShutterSpeed,
    Iso,
    Exposure,
    MeteredExposure,
    ExposureCompensation,
    StillCaptureMode,
    OsdImageMode,
    LiveViewStatus,
    StillImageSaveDestination,
    PositionKeySetting,
    SetLiveViewEnable,
    SetPostViewEnable,
    ShutterHalfReleaseButton,
    ShutterReleaseButton,
    S1S2Button,
    MovieRecButton,
    LiveViewImageQuality,
    ContentTransferEnable,
    FocusIndication,
} as const satisfies { [key: string]: PropertyDefinition }

export type SonyPropertyDef = (typeof sonyPropertyRegistry)[keyof typeof sonyPropertyRegistry]
