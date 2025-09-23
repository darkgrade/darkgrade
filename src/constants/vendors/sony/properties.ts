/**
 * Sony property definitions - extending and overriding PTP
 */

import { DataType, HexCode, PropertyDefinition } from '@constants/types'
import { PTPProperties } from '@constants/ptp/properties'
import { VendorIDs } from '@constants/vendors/vendor-ids'
import { encodePTPValue } from '@core/buffers'

/**
 * Sony Device Constants
 */
export const SonyConstants = {
    VENDOR_ID: VendorIDs.SONY,
    DEVICE_PROPERTY_OPTION: 0x01,
    // from the Sony Reference document, kind of buried
    // The Initiator Version and SDIExtensionVersion are 0x012C (3.00) in this version.
    // “3” indicates the major version, and “00” indicates the minor version
    PROTOCOL_VERSION: 0x012c,
    SDIO_FRAME_BUFFER_SIZE: 1024 * 1024, // 1MB frame buffer for SDIO parsing
    SDIO_HEADER_SIZE: 8, // SDIO packet header size
} as const

/**
 * Sony property definitions - extending and overriding PTP
 * Vendor extensions don't need validation as they define their own shape
 */
export const SonyProperties = {
    ...PTPProperties, // Start with PTP standard

    // Override PTP properties with Sony-specific implementations
    APERTURE: {
        name: 'APERTURE',
        code: 0x5007,
        type: DataType.UINT16,
        unit: 'f-stop',
        description: 'Aperture f-number (Sony encoding)',
        writable: true,
        encode: (value: string | number) => {
            const num = typeof value === 'string' ? parseFloat(value.replace('f/', '')) : value
            return encodePTPValue(Math.round(num * 100), DataType.UINT16)
        },
        decode: (value: HexCode | Uint8Array) => {
            const num = typeof value === 'number' ? value : 0
            return `f/${(num / 100).toFixed(1)}`
        },
    },

    ISO: {
        name: 'ISO',
        code: 0xd21e,
        type: DataType.UINT32, // Sony uses UINT32 instead of UINT16
        unit: 'ISO',
        description: 'ISO sensitivity with Sony-specific auto modes',
        writable: true,
        encode: (value: string | number) => {
            let numValue: number
            if (typeof value === 'string') {
                if (value === 'AUTO' || value === 'ISO AUTO') numValue = 0x00ffffff
                else if (value === 'MULTI_NR_AUTO') numValue = 0x01ffffff
                else if (value === 'MULTI_NR_HIGH_AUTO') numValue = 0x02ffffff
                else {
                    const match = value.match(/\d+/)
                    numValue = match ? parseInt(match[0]) : 0
                }
            } else {
                numValue = value
            }
            return encodePTPValue(numValue, DataType.UINT32)
        },
        decode: (value: HexCode | Uint8Array) => {
            const num = typeof value === 'number' ? value : 0
            // Special AUTO values
            if (num === 0x00ffffff) return 'ISO AUTO'
            if (num === 0x01ffffff) return 'Multi Frame NR ISO AUTO'
            if (num === 0x02ffffff) return 'Multi Frame NR High ISO AUTO'

            // Check for Multi Frame NR modes (prefix byte)
            const prefix = (num >> 24) & 0xff
            let mode = ''
            if (prefix === 0x01) {
                mode = 'Multi Frame NR '
            } else if (prefix === 0x02) {
                mode = 'Multi Frame NR High '
            }

            // Extract the actual ISO value (lower 24 bits)
            const isoValue = num & 0xffffff

            // Sony uses direct decimal values for ISO
            if (isoValue >= 10 && isoValue <= 1000000) {
                return `${mode}ISO ${isoValue}`
            }

            return 'ISO Unknown'
        },
    },

    // Sony-specific device properties
    STILL_CAPTURE_MODE: {
        name: 'STILL_CAPTURE_MODE',
        code: 0x5013,
        type: DataType.UINT16,
        description: 'Still capture mode',
        writable: true,
        enum: {
            SINGLE: 0x0001,
            BURST: 0x0002,
            TIMELAPSE: 0x0003,
        },
    },

    OSD_IMAGE_MODE: {
        name: 'OSD_IMAGE_MODE',
        code: 0xd207,
        type: DataType.UINT8,
        description: 'On-screen display image mode',
        writable: true,
        enum: {
            OFF: 0x00,
            ON: 0x01,
        },
    },

    SHUTTER_SPEED: {
        name: 'SHUTTER_SPEED',
        code: 0xd20d,
        type: DataType.UINT32,
        unit: 'seconds',
        description: 'Sony-specific shutter speed encoding with bulb mode support',
        writable: true,
        encode: (value: string) => {
            let numValue: number
            if (value === 'BULB') numValue = 0x00000000
            else if (value === 'N/A') numValue = 0xffffffff
            else if (value.startsWith('1/')) {
                // Handle fractional format (e.g., "1/250")
                const denom = parseInt(value.substring(2))
                numValue = (0x0001 << 16) | denom
            } else {
                // Handle seconds format (e.g., '1.5"' or "1.5")
                const cleanValue = value.replace('"', '')
                const seconds = parseFloat(cleanValue)
                if (!isNaN(seconds)) {
                    numValue = (Math.round(seconds * 10) << 16) | 0x000a
                } else {
                    numValue = 0xffffffff // N/A
                }
            }
            return encodePTPValue(numValue, DataType.UINT32)
        },
        decode: (value: HexCode | Uint8Array) => {
            const num = typeof value === 'number' ? value : 0
            if (num === 0x00000000) return 'BULB'
            if (num === 0xffffffff) return 'N/A'

            const numerator = (num >> 16) & 0xffff
            const denominator = num & 0xffff

            if (denominator === 0x000a) {
                // Real number display (e.g., 1.5")
                return `${numerator / 10}"`
            } else if (numerator === 0x0001) {
                // Fraction display (e.g., 1/1000)
                return `1/${denominator}`
            } else {
                return `${numerator}/${denominator}`
            }
        },
    },

    CAPTURE_STATUS: {
        name: 'CAPTURE_STATUS',
        code: 0xd215,
        type: DataType.UINT8,
        description: 'Camera capture status',
        writable: false,
        enum: {
            IDLE: 0x00,
            CAPTURING: 0x01,
            PROCESSING: 0x02,
        },
    },

    LIVE_VIEW_STATUS: {
        name: 'LIVE_VIEW_STATUS',
        code: 0xd221,
        type: DataType.UINT8,
        description: 'Live view status',
        writable: false,
        enum: {
            OFF: 0x00,
            ON: 0x01,
        },
    },

    SAVE_MEDIA: {
        name: 'SAVE_MEDIA',
        code: 0xd222,
        type: DataType.UINT8,
        description: 'Where to save captured images',
        writable: true,
        enum: {
            CAMERA: 0x00,
            HOST: 0x01,
            BOTH: 0x02,
        },
    },

    DIAL_MODE: {
        name: 'DIAL_MODE',
        code: 0xd25a,
        type: DataType.UINT8,
        description: 'Camera dial mode control (controls which setting takes priority between host and camera)',
        writable: true,
        enum: {
            CAMERA: 0x00,
            HOST: 0x01,
        },
    },

    SHUTTER_BUTTON_CONTROL: {
        name: 'SHUTTER_BUTTON_CONTROL',
        code: 0xd2c1,
        type: DataType.UINT16,
        description: 'Shutter button control property',
        writable: true,
        enum: {
            RELEASE: 0x0000,
            FULL_PRESS: 0x0001,
            HALF_PRESS: 0x0002,
        },
    },

    FOCUS_BUTTON_CONTROL: {
        name: 'FOCUS_BUTTON_CONTROL',
        code: 0xd2c2,
        type: DataType.UINT16,
        description: 'Focus button control property',
        writable: true,
        enum: {
            RELEASE: 0x0000,
            FULL_PRESS: 0x0001,
            HALF_PRESS: 0x0002,
        },
    },

    LIVE_VIEW_CONTROL: {
        name: 'LIVE_VIEW_CONTROL',
        code: 0xd313,
        type: DataType.UINT16,
        description: 'Live view control property',
        writable: true,
        enum: {
            DISABLE: 0x0001,
            ENABLE: 0x0002,
        },
    },
} as const satisfies PropertyDefinition

export type SonyPropertyDefinitions = typeof SonyProperties
