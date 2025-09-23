/**
 * Sony property definitions - extending and overriding PTP
 */

import { DataType, PropertyDefinition } from '@constants/types'
import { PTPProperties, parseAperture, parseISO, parseShutter } from '@constants/ptp/properties'
import { encodePTPValue, decodePTPValue } from '@core/buffers'

export const SonyProperties = {
    ...PTPProperties,

    APERTURE: {
        name: 'APERTURE',
        code: 0x5007,
        type: DataType.UINT16,
        unit: 'F-Stop',
        description: 'Get/Set the aperture value.',
        writable: true,
        encode: (value: string): Uint8Array => {
            const v = String(value).toLowerCase()
            if (v === 'iris close') return encodePTPValue(0xfffd, DataType.UINT16)
            if (v === '--') return encodePTPValue(0xfffe, DataType.UINT16)
            if (v === 'nothing to display') return encodePTPValue(0xffff, DataType.UINT16)
            return encodePTPValue(Math.round(parseAperture(value) * 100), DataType.UINT16)
        },
        decode: (value: Uint8Array): string => {
            const hexValue = decodePTPValue(value, DataType.UINT16)
            
            return hexValue === 0xfffd ? 'Iris Close' :
                   hexValue === 0xfffe ? '--' :
                   hexValue === 0xffff ? 'nothing to display' :
                   `f/${hexValue / 100}"`
        },
    },

    SHUTTER_SPEED: {
        name: 'SHUTTER_SPEED',
        code: 0xd20d,
        type: DataType.UINT32,
        description: 'Get/Set the shutter speed.',
        writable: true,
        encode: (value: string): Uint8Array => {
            const [n, d] = parseShutter(value)
            if (n === 0 && d === 0) return encodePTPValue(0x00000000, DataType.UINT32)
            return encodePTPValue((n << 16) | d, DataType.UINT32)
        },
        decode: (value: Uint8Array): string => {
            const hexValue = decodePTPValue(value, DataType.UINT32)
            if (hexValue === 0x00000000) return 'BULB'
            
            const numerator = (hexValue >> 16) & 0xffff
            const denominator = hexValue & 0xffff
            
            return denominator === 0x000a 
                ? `${numerator / 10}"`
                : numerator === 1 
                  ? `1/${denominator}`
                  : `${numerator}/${denominator}`
        },
    },

    ISO: {
        name: 'ISO',
        code: 0xd21e,
        type: DataType.UINT32,
        unit: 'ISO',
        description: 'Get/Set the ISO sensitivity.',
        writable: true,
        encode: (value: string): Uint8Array => {
            const v = String(value).toLowerCase()
            const isoValue = parseISO(value)
            if (isoValue === 0xffffff || v.includes('auto')) return encodePTPValue(0x00ffffff, DataType.UINT32)
            const modePrefix = v.includes('multi frame nr high') ? 0x02000000
                : v.includes('multi frame nr') ? 0x01000000 : 0x00000000
            return encodePTPValue(modePrefix | isoValue, DataType.UINT32)
        },
        decode: (value: Uint8Array): string => {
            const hexValue = decodePTPValue(value, DataType.UINT32)
            if (hexValue === 0x00ffffff) return 'ISO AUTO'

            const modePrefix = hexValue & 0xff000000
            const isoValue = hexValue & 0x00ffffff

            return modePrefix === 0x00000000
                ? `ISO ${isoValue}`
                : modePrefix === 0x01000000
                  ? `Multi Frame NR ISO ${isoValue}`
                  : modePrefix === 0x02000000
                    ? `Multi Frame NR High ISO ${isoValue}`
                    : `Unknown ISO mode: 0x${hexValue.toString(16).padStart(8, '0')}`
        },
    },

    STILL_CAPTURE_MODE: {
        name: 'STILL_CAPTURE_MODE',
        code: 0x5013,
        type: DataType.UINT32,
        description: 'Get/Set the drive mode.',
        writable: true,
        enum: {
            Normal: 0x00000001,
            'Continuous Shooting Hi': 0x00010002,
            'Continuous Shooting Hi+': 0x00018010,
            'Continuous Shooting Hi-Live': 0x00018011,
            'Continuous Shooting Lo': 0x00018012,
            'Continuous Shooting': 0x00018013,
            'Continuous Shooting Speed Priority': 0x00018014,
            'Continuous Shooting Mid': 0x00018015,
            'Continuous Shooting Mid-Live': 0x00018016,
            'Continuous Shooting Lo-Live': 0x00018017,
            Timelapse: 0x00020003,
            'Self Timer 5 Sec.': 0x00038003,
            'Self Timer 10 Sec.': 0x00038004,
            'Self Timer 2 Sec.': 0x00038005,
            'Continuous Bracket 0.3 EV 2 Img. +': 0x0004c237,
            'Continuous Bracket 0.3 EV 2 Img. -': 0x0004c23f,
            'Continuous Bracket 0.3 EV 3 Img.': 0x00048337,
            'Continuous Bracket 0.3 EV 5 Img.': 0x00048537,
            'Continuous Bracket 0.3 EV 7 Img.': 0x00048737,
            'Continuous Bracket 0.3 EV 9 Img.': 0x00048937,
            'Continuous Bracket 0.5 EV 2 Img. +': 0x0004c257,
            'Continuous Bracket 0.5 EV 2 Img. -': 0x0004c25f,
            'Continuous Bracket 0.5 EV 3 Img.': 0x00048357,
            'Continuous Bracket 0.5 EV 5 Img.': 0x00048557,
            'Continuous Bracket 0.5 EV 7 Img.': 0x00048757,
            'Continuous Bracket 0.5 EV 9 Img.': 0x00048957,
            'Continuous Bracket 0.7 EV 2 Img. +': 0x0004c277,
            'Continuous Bracket 0.7 EV 2 Img. -': 0x0004c27f,
            'Continuous Bracket 0.7 EV 3 Img.': 0x00048377,
            'Continuous Bracket 0.7 EV 5 Img.': 0x00048577,
            'Continuous Bracket 0.7 EV 7 Img.': 0x00048777,
            'Continuous Bracket 0.7 EV 9 Img.': 0x00048977,
            'Continuous Bracket 1.0 EV 2 Img. +': 0x0004c211,
            'Continuous Bracket 1.0 EV 2 Img. -': 0x0004c219,
            'Continuous Bracket 1.0 EV 3 Img.': 0x00048311,
            'Continuous Bracket 1.0 EV 5 Img.': 0x00048511,
            'Continuous Bracket 1.0 EV 7 Img.': 0x00048711,
            'Continuous Bracket 1.0 EV 9 Img.': 0x00048911,
            'Continuous Bracket 1.3 EV 2 Img. +': 0x0004c241,
            'Continuous Bracket 1.3 EV 2 Img. -': 0x0004c249,
            'Continuous Bracket 1.3 EV 3 Img.': 0x00048341,
            'Continuous Bracket 1.3 EV 5 Img.': 0x00048541,
            'Continuous Bracket 1.3 EV 7 Img.': 0x00048741,
            'Continuous Bracket 1.5 EV 2 Img. +': 0x0004c261,
            'Continuous Bracket 1.5 EV 2 Img. -': 0x0004c269,
            'Continuous Bracket 1.5 EV 3 Img.': 0x00048361,
            'Continuous Bracket 1.5 EV 5 Img.': 0x00048561,
            'Continuous Bracket 1.5 EV 7 Img.': 0x00048761,
            'Continuous Bracket 1.7 EV 2 Img. +': 0x0004c281,
            'Continuous Bracket 1.7 EV 2 Img. -': 0x0004c289,
            'Continuous Bracket 1.7 EV 3 Img.': 0x00048381,
            'Continuous Bracket 1.7 EV 5 Img.': 0x00048581,
            'Continuous Bracket 1.7 EV 7 Img.': 0x00048781,
            'Continuous Bracket 2.0 EV 2 Img. +': 0x0004c221,
            'Continuous Bracket 2.0 EV 2 Img. -': 0x0004c229,
            'Continuous Bracket 2.0 EV 3 Img.': 0x00048321,
            'Continuous Bracket 2.0 EV 5 Img.': 0x00048521,
            'Continuous Bracket 2.0 EV 7 Img.': 0x00048721,
            'Continuous Bracket 2.3 EV 2 Img. +': 0x0004c251,
            'Continuous Bracket 2.3 EV 2 Img. -': 0x0004c259,
            'Continuous Bracket 2.3 EV 3 Img.': 0x00048351,
            'Continuous Bracket 2.3 EV 5 Img.': 0x00048551,
            'Continuous Bracket 2.5 EV 2 Img. +': 0x0004c271,
            'Continuous Bracket 2.5 EV 2 Img. -': 0x0004c279,
            'Continuous Bracket 2.5 EV 3 Img.': 0x00048371,
            'Continuous Bracket 2.5 EV 5 Img.': 0x00048571,
            'Continuous Bracket 2.7 EV 2 Img. +': 0x0004c291,
            'Continuous Bracket 2.7 EV 2 Img. -': 0x0004c299,
            'Continuous Bracket 2.7 EV 3 Img.': 0x00048391,
            'Continuous Bracket 2.7 EV 5 Img.': 0x00048591,
            'Continuous Bracket 3.0 EV 2 Img. +': 0x0004c231,
            'Continuous Bracket 3.0 EV 2 Img. -': 0x0004c239,
            'Continuous Bracket 3.0 EV 3 Img.': 0x00048331,
            'Continuous Bracket 3.0 EV 5 Img.': 0x00048531,
            'Single Bracket 0.3 EV 2 Img. +': 0x0005c236,
            'Single Bracket 0.3 EV 2 Img. -': 0x0005c23e,
            'Single Bracket 0.3 EV 3 Img.': 0x00058336,
            'Single Bracket 0.3 EV 5 Img.': 0x00058536,
            'Single Bracket 0.3 EV 7 Img.': 0x00058736,
            'Single Bracket 0.3 EV 9 Img.': 0x00058936,
            'Single Bracket 0.5 EV 2 Img. +': 0x0005c256,
            'Single Bracket 0.5 EV 2 Img. -': 0x0005c25e,
            'Single Bracket 0.5 EV 3 Img.': 0x00058356,
            'Single Bracket 0.5 EV 5 Img.': 0x00058556,
            'Single Bracket 0.5 EV 7 Img.': 0x00058756,
            'Single Bracket 0.5 EV 9 Img.': 0x00058956,
            'Single Bracket 0.7 EV 2 Img. +': 0x0005c276,
            'Single Bracket 0.7 EV 2 Img. -': 0x0005c27e,
            'Single Bracket 0.7 EV 3 Img.': 0x00058376,
            'Single Bracket 0.7 EV 5 Img.': 0x00058576,
            'Single Bracket 0.7 EV 7 Img.': 0x00058776,
            'Single Bracket 0.7 EV 9 Img.': 0x00058976,
            'Single Bracket 1.0 EV 2 Img. +': 0x0005c210,
            'Single Bracket 1.0 EV 2 Img. -': 0x0005c218,
            'Single Bracket 1.0 EV 3 Img.': 0x00058310,
            'Single Bracket 1.0 EV 5 Img.': 0x00058510,
            'Single Bracket 1.0 EV 7 Img.': 0x00058710,
            'Single Bracket 1.0 EV 9 Img.': 0x00058910,
            'Single Bracket 1.3 EV 2 Img. +': 0x0005c240,
            'Single Bracket 1.3 EV 2 Img. -': 0x0005c248,
            'Single Bracket 1.3 EV 3 Img.': 0x00058340,
            'Single Bracket 1.3 EV 5 Img.': 0x00058540,
            'Single Bracket 1.3 EV 7 Img.': 0x00058740,
            'Single Bracket 1.5 EV 2 Img. +': 0x0005c260,
            'Single Bracket 1.5 EV 2 Img. -': 0x0005c268,
            'Single Bracket 1.5 EV 3 Img.': 0x00058360,
            'Single Bracket 1.5 EV 5 Img.': 0x00058560,
            'Single Bracket 1.5 EV 7 Img.': 0x00058760,
            'Single Bracket 1.7 EV 2 Img. +': 0x0005c280,
            'Single Bracket 1.7 EV 2 Img. -': 0x0005c288,
            'Single Bracket 1.7 EV 3 Img.': 0x00058380,
            'Single Bracket 1.7 EV 5 Img.': 0x00058580,
            'Single Bracket 1.7 EV 7 Img.': 0x00058780,
            'Single Bracket 2.0 EV 2 Img. +': 0x0005c220,
            'Single Bracket 2.0 EV 2 Img. -': 0x0005c228,
            'Single Bracket 2.0 EV 3 Img.': 0x00058320,
            'Single Bracket 2.0 EV 5 Img.': 0x00058520,
            'Single Bracket 2.0 EV 7 Img.': 0x00058720,
            'Single Bracket 2.3 EV 2 Img. +': 0x0005c250,
            'Single Bracket 2.3 EV 2 Img. -': 0x0005c258,
            'Single Bracket 2.3 EV 3 Img.': 0x00058350,
            'Single Bracket 2.3 EV 5 Img.': 0x00058550,
            'Single Bracket 2.5 EV 2 Img. +': 0x0005c270,
            'Single Bracket 2.5 EV 2 Img. -': 0x0005c278,
            'Single Bracket 2.5 EV 3 Img.': 0x00058370,
            'Single Bracket 2.5 EV 5 Img.': 0x00058570,
            'Single Bracket 2.7 EV 2 Img. +': 0x0005c290,
            'Single Bracket 2.7 EV 2 Img. -': 0x0005c298,
            'Single Bracket 2.7 EV 3 Img.': 0x00058390,
            'Single Bracket 2.7 EV 5 Img.': 0x00058590,
            'Single Bracket 3.0 EV 2 Img. +': 0x0005c230,
            'Single Bracket 3.0 EV 2 Img. -': 0x0005c238,
            'Single Bracket 3.0 EV 3 Img.': 0x00058330,
            'Single Bracket 3.0 EV 5 Img.': 0x00058530,
            'White Balance Bracket Lo': 0x00068018,
            'White Balance Bracket Hi': 0x00068028,
            'DRO Bracket Lo': 0x00078019,
            'DRO Bracket Hi': 0x00078029,
            'LPF Bracket': 0x0007801a,
            'Remote Commander': 0x0007800a,
            'Mirror Up': 0x0007800b,
            'Self Portrait 1 Person': 0x00078006,
            'Self Portrait 2 People': 0x00078007,
            'Continuous Self Timer 3 Img.': 0x00088008,
            'Continuous Self Timer 5 Img.': 0x00088009,
            'Continuous Self Timer 3 Img. 5 Sec.': 0x0008800c,
            'Continuous Self Timer 5 Img. 5 Sec.': 0x0008800d,
            'Continuous Self Timer 3 Img. 2 Sec.': 0x0008800e,
            'Continuous Self Timer 5 Img. 2 Sec.': 0x0008800f,
            'Spot Burst Shooting Lo': 0x00098030,
            'Spot Burst Shooting Mid': 0x00098031,
            'Spot Burst Shooting Hi': 0x00098032,
            'Focus Bracket': 0x000a8040,
        },
    },

    OSD_IMAGE_MODE: {
        name: 'OSD_IMAGE_MODE',
        code: 0xd207,
        type: DataType.UINT8,
        description: 'Get/Set the OSD image mode',
        writable: true,
        enum: {
            OFF: 0x00,
            ON: 0x01,
        },
    },

    LIVE_VIEW_STATUS: {
        name: 'LIVE_VIEW_STATUS',
        code: 0xd221,
        type: DataType.UINT8,
        description: 'Get the live view status.',
        writable: false,
        enum: {
            SUPPORTED_DISABLED: 0x00,
            SUPPORTED_ENABLED: 0x01,
            NOT_SUPPORTED: 0x02,
        },
    },

    STILL_IMAGE_SAVE_DESTINATION: {
        name: 'STILL_IMAGE_SAVE_DESTINATION',
        code: 0xd222,
        type: DataType.UINT8,
        description: 'Get the information of still image save destination.',
        writable: true,
        enum: {
            CAMERA_DEVICE: 0x0001,
            HOST_DEVICE: 0x0010,
            BOTH_DEVICES: 0x0011,
        },
    },

    POSITION_KEY_SETTING: {
        name: 'POSITION_KEY_SETTING',
        code: 0xd25a,
        type: DataType.UINT8,
        description: 'Get/Set the position key setting (controls which setting takes priority between host and camera)',
        writable: true,
        enum: {
            CAMERA_PRIORITY: 0x00,
            HOST_PRIORITY: 0x01,
        },
    },

    SET_LIVE_VIEW_ENABLE: {
        name: 'SET_LIVE_VIEW_ENABLE',
        code: 0xd313,
        type: DataType.UINT16,
        // TODO enable this
        description:
            'Set live view enable. When using Live View while connected in “Remote Control with Transfer Mode,” it is necessary to enable the feature using this Control Code.',
        writable: true,
        enum: {
            DISABLE: 0x0001,
            ENABLE: 0x0002,
        },
    },

    SHUTTER_HALF_RELEASE_BUTTON: {
        name: 'SHUTTER_HALF_RELEASE_BUTTON',
        code: 0xd2c1,
        type: DataType.UINT16,
        description: 'Control shutter half-release (S1) (focus) button.',
        writable: true,
        enum: {
            UP: 0x0001,
            DOWN: 0x0002,
        },
    },

    SHUTTER_RELEASE_BUTTON: {
        name: 'SHUTTER_RELEASE_BUTTON',
        code: 0xd2c2,
        type: DataType.UINT16,
        description: 'Control shutter release (S2) button.',
        writable: true,
        enum: {
            UP: 0x0001,
            DOWN: 0x0002,
        },
    },
} as const satisfies PropertyDefinition<any>

export type SonyPropertyDefinitions = typeof SonyProperties
