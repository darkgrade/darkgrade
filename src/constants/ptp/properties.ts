/**
 * PTP standard property definitions with type validation
 */

import { DataType, PropertyDefinition, HexCode } from '@constants/types'
import { decodePTPValue, encodePTPValue } from '@core/buffers'

// Helper functions for parsing various input formats
export const parseAperture = (v: string | number): number => {
    const s = String(v).toLowerCase()
        .replace(/[fƒ]/g, '')  // Remove f or fancy ƒ
        .replace(/[\/:\s]/g, '') // Remove /, :, spaces
    return parseFloat(s) || 0
}

export const parseISO = (v: string | number): number => {
    const s = String(v).toLowerCase().replace(/iso\s*/g, '')
    if (s === 'auto') return 0xffffff // Special auto value
    return parseInt(s) || 0
}

export const parseShutter = (v: string): [number, number] => {
    let s = String(v).toLowerCase().trim()
    if (s === 'bulb' || s === 'b') return [0, 0]
    
    // Remove quotes and time suffixes
    s = s.replace(/["'`]/g, '').replace(/\s*(sec(onds?)?|s)\s*$/g, '')
    
    // Handle fractions like 1/250 or 1/8000
    if (s.includes('/')) {
        const parts = s.split('/')
        const n = parseInt(parts[0]) || 1
        const d = parseInt(parts[1]) || 1
        return [n, d]
    }
    
    // Parse as decimal
    const num = parseFloat(s)
    if (isNaN(num)) return [1, 1]
    
    // Sony camera uses:
    // - Decimal notation (with denominator 10) for speeds >= 0.4" (30", 15", 8", 4", 2", 1", 0.8", 0.6", 0.4")
    // - Fraction notation for speeds < 0.4" (1/3, 1/4, 1/8, 1/15, etc.)
    
    if (num >= 0.4) {
        // Use decimal notation with denominator 10
        return [Math.round(num * 10), 10]
    } else {
        // Convert to fraction for fast speeds
        const denominator = Math.round(1 / num)
        return [1, denominator]
    }
}

/**
 * PTP standard property definitions with type validation
 */
export const PTPProperties = {
    ISO: {
        name: 'ISO',
        description:
            '(AKA ExposureIndex / Exposure Index) this property allows the emulation of film speed settings on a digital camera. The settings correspond to the ISO designations (ASA/DIN). Typically, a device supports discrete enumerated values but continuous control over a range is possible. A value of 0xFFFF corresponds to the automatic ISO setting.',
        code: 0x500f,
        type: DataType.UINT16,
        unit: 'ISO',
        writable: true,
        encode: (value: string) => {
            return encodePTPValue(value, DataType.UINT32)
        },
        decode: (value: HexCode | Uint8Array) => {
            return `ISO ${decodePTPValue(value as Uint8Array, DataType.UINT32)}`
        },
    },
    SHUTTER_SPEED: {
        name: 'SHUTTER_SPEED',
        description:
            '(AKA ExposureTime / Exposure Time) this property corresponds to the shutter speed. It has units of seconds scaled by 10 000. When the device is in an automatic exposure program mode, the setting of this property via SetDeviceProp may cause other properties to change. Like all properties that cause other properties to change, the device is required to issue DevicePropChanged events for the other properties that changed as a result of the initial change. This property is typically only used by the device when the ProgramExposureMode is set to manual or shutter priority.',
        code: 0x500d,
        type: DataType.UINT32,
        unit: 'seconds',
        writable: true,
        encode: (value: number) => {
            return encodePTPValue(value * 10000, DataType.UINT32)
        },
        decode: (value: HexCode | Uint8Array) => {
            const seconds = decodePTPValue(value as Uint8Array, DataType.UINT32) / 10000
            
            // Handle special cases
            if (seconds === 0) return 'bulb'
            if (seconds >= 1) return `${seconds}"`
            
            // Convert to fraction for fast shutter speeds
            const denominator = Math.round(1 / seconds)
            return `1/${denominator}`
        },
    },
    APERTURE: {
        name: 'APERTURE',
        description:
            '(AKA FNumber / F-Number / F Number / FStop / F-Stop / F Stop) this property corresponds to the aperture of the lens. The units are equal to the F-number scaled by 100. When the device is in an automatic exposure program mode, the setting of this property via the SetDeviceProp operation may cause other properties such as exposure time and exposure index to change. Like all device properties that cause other device properties to change, the device is required to issue DevicePropChanged events for the other device properties that changed as a side effect of the invoked change. The setting of this property is typically only valid when the device has an ExposureProgramMode setting of manual or aperture priority.',
        code: 0x5007,
        type: DataType.UINT16,
        unit: 'f-stop',
        writable: true,
        encode: (value: number) => {
            return encodePTPValue(value * 100, DataType.UINT16)
        },
        decode: (value: HexCode | Uint8Array) => {
            return `f/${decodePTPValue(value as Uint8Array, DataType.UINT16) / 100}`
        },
    },
} as const satisfies PropertyDefinition<any>

export type PTPPropertyDefinitions = typeof PTPProperties
