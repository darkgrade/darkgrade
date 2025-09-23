/**
 * Sony property definitions - extending and overriding PTP
 * V7 Architecture - Vendor extensions don't require validation
 */

import { DataType } from '@constants/types'
import { PTPProperties } from '@constants/ptp/properties'
import type { HexCode } from '@constants/types'

/**
 * Sony Device Constants
 */
export const SonyConstants = {
  VENDOR_ID: 0x054c,
  PRODUCT_ID: 0x096f,
  PRODUCT_ID_ALPHA: 0x0e78,
  PROTOCOL_VERSION: 0x012c,
  DEVICE_PROPERTY_OPTION: 0x01,
} as const

/**
 * Sony property definitions - extending and overriding PTP
 * Vendor extensions don't need validation as they define their own shape
 */
export const SonyProperties = {
  ...PTPProperties, // Start with PTP standard
  
  // Override PTP properties with Sony-specific implementations
  F_NUMBER: {
    name: 'F_NUMBER',
    code: 0x5007,
    type: DataType.UINT16,
    unit: 'f-stop',
    description: 'Aperture f-number (Sony encoding)',
    writable: true,
    encode: (value: string | number) => {
      const num = typeof value === 'string' 
        ? parseFloat(value.replace('f/', ''))
        : value
      return Math.round(num * 100)
    },
    decode: (value: HexCode | Uint8Array) => {
      const num = typeof value === 'number' ? value : 0
      return `f/${(num / 100).toFixed(1)}`
    }
  },
  
  EXPOSURE_INDEX: {
    name: 'EXPOSURE_INDEX',
    code: 0x500F,
    type: DataType.UINT32, // Sony uses UINT32 instead of UINT16
    unit: 'ISO',
    description: 'ISO sensitivity with Sony-specific auto modes',
    writable: true,
    encode: (value: string | number) => {
      if (typeof value === 'string') {
        if (value === 'AUTO' || value === 'ISO AUTO') return 0x00FFFFFF
        if (value === 'MULTI_NR_AUTO') return 0x01FFFFFF
        if (value === 'MULTI_NR_HIGH_AUTO') return 0x02FFFFFF
        const match = value.match(/\d+/)
        return match ? parseInt(match[0]) : 0
      }
      return value
    },
    decode: (value: HexCode | Uint8Array) => {
      const num = typeof value === 'number' ? value : 0
      // Special AUTO values
      if (num === 0x00FFFFFF) return 'ISO AUTO'
      if (num === 0x01FFFFFF) return 'Multi Frame NR ISO AUTO'
      if (num === 0x02FFFFFF) return 'Multi Frame NR High ISO AUTO'
      
      // Check for Multi Frame NR modes (prefix byte)
      const prefix = (num >> 24) & 0xFF
      let mode = ''
      if (prefix === 0x01) {
        mode = 'Multi Frame NR '
      } else if (prefix === 0x02) {
        mode = 'Multi Frame NR High '
      }
      
      // Extract the actual ISO value (lower 24 bits)
      const isoValue = num & 0xFFFFFF
      
      // Sony uses direct decimal values for ISO
      if (isoValue >= 10 && isoValue <= 1000000) {
        return `${mode}ISO ${isoValue}`
      }
      
      return 'ISO Unknown'
    }
  },
  
  // Sony-specific device properties
  STILL_CAPTURE_MODE: {
    name: 'STILL_CAPTURE_MODE',
    code: 0x5013,
    type: DataType.UINT16,
    description: 'Still capture mode',
    writable: true,
    enum: {
      'SINGLE': 0x0001,
      'BURST': 0x0002,
      'TIMELAPSE': 0x0003,
    }
  },
  
  OSD_IMAGE_MODE: {
    name: 'OSD_IMAGE_MODE',
    code: 0xD207,
    type: DataType.UINT8,
    description: 'On-screen display image mode',
    writable: true,
    enum: {
      'OFF': 0x00,
      'ON': 0x01,
    }
  },
  
  SHUTTER_SPEED: {
    name: 'SHUTTER_SPEED',
    code: 0xD20D,
    type: DataType.UINT32,
    unit: 'seconds',
    description: 'Sony-specific shutter speed encoding with bulb mode support',
    writable: true,
    encode: (value: string) => {
      if (value === 'BULB') return 0x00000000
      if (value === 'N/A') return 0xFFFFFFFF
      
      // Handle fractional format (e.g., "1/250")
      if (value.startsWith('1/')) {
        const denom = parseInt(value.substring(2))
        return (0x0001 << 16) | denom
      }
      
      // Handle seconds format (e.g., '1.5"' or "1.5")
      const cleanValue = value.replace('"', '')
      const seconds = parseFloat(cleanValue)
      if (!isNaN(seconds)) {
        return (Math.round(seconds * 10) << 16) | 0x000A
      }
      
      return 0xFFFFFFFF // N/A
    },
    decode: (value: HexCode | Uint8Array) => {
      const num = typeof value === 'number' ? value : 0
      if (num === 0x00000000) return 'BULB'
      if (num === 0xFFFFFFFF) return 'N/A'
      
      const numerator = (num >> 16) & 0xFFFF
      const denominator = num & 0xFFFF
      
      if (denominator === 0x000A) {
        // Real number display (e.g., 1.5")
        return `${numerator / 10}"`
      } else if (numerator === 0x0001) {
        // Fraction display (e.g., 1/1000)
        return `1/${denominator}`
      } else {
        return `${numerator}/${denominator}`
      }
    }
  },
  
  CAPTURE_STATUS: {
    name: 'CAPTURE_STATUS',
    code: 0xD215,
    type: DataType.UINT8,
    description: 'Camera capture status',
    writable: false,
    enum: {
      'IDLE': 0x00,
      'CAPTURING': 0x01,
      'PROCESSING': 0x02,
    }
  },
  
  ISO_SENSITIVITY_ALT1: {
    name: 'ISO_SENSITIVITY_ALT1',
    code: 0xD21D,
    type: DataType.UINT32,
    unit: 'ISO',
    description: 'Alternative ISO property 1',
    writable: true
  },
  
  ISO_SENSITIVITY: {
    name: 'ISO_SENSITIVITY',
    code: 0xD21E,
    type: DataType.UINT32,
    unit: 'ISO',
    description: 'ISO sensitivity (main Sony property)',
    writable: true,
    encode: (value: string | number) => {
      if (typeof value === 'string') {
        if (value === 'AUTO' || value === 'ISO AUTO') return 0x00FFFFFF
        if (value === 'MULTI_NR_AUTO') return 0x01FFFFFF
        if (value === 'MULTI_NR_HIGH_AUTO') return 0x02FFFFFF
        const match = value.match(/\d+/)
        return match ? parseInt(match[0]) : 0
      }
      return value
    },
    decode: (value: HexCode | Uint8Array) => {
      const num = typeof value === 'number' ? value : 0
      // Special AUTO values
      if (num === 0x00FFFFFF) return 'ISO AUTO'
      if (num === 0x01FFFFFF) return 'Multi Frame NR ISO AUTO'
      if (num === 0x02FFFFFF) return 'Multi Frame NR High ISO AUTO'
      
      // Check for Multi Frame NR modes (prefix byte)
      const prefix = (num >> 24) & 0xFF
      let mode = ''
      if (prefix === 0x01) {
        mode = 'Multi Frame NR '
      } else if (prefix === 0x02) {
        mode = 'Multi Frame NR High '
      }
      
      // Extract the actual ISO value (lower 24 bits)
      const isoValue = num & 0xFFFFFF
      
      // Sony uses direct decimal values for ISO
      if (isoValue >= 10 && isoValue <= 1000000) {
        return `${mode}ISO ${isoValue}`
      }
      
      return 'ISO Unknown'
    }
  },
  
  ISO_SENSITIVITY_ALT2: {
    name: 'ISO_SENSITIVITY_ALT2',
    code: 0xD21F,
    type: DataType.UINT32,
    unit: 'ISO',
    description: 'Alternative ISO property 2',
    writable: true
  },
  
  ISO_SENSITIVITY_ALT3: {
    name: 'ISO_SENSITIVITY_ALT3',
    code: 0xD220,
    type: DataType.UINT32,
    unit: 'ISO',
    description: 'Alternative ISO property 3',
    writable: true
  },
  
  LIVE_VIEW_STATUS: {
    name: 'LIVE_VIEW_STATUS',
    code: 0xD221,
    type: DataType.UINT8,
    description: 'Live view status',
    writable: false,
    enum: {
      'OFF': 0x00,
      'ON': 0x01,
    }
  },
  
  SAVE_MEDIA: {
    name: 'SAVE_MEDIA',
    code: 0xD222,
    type: DataType.UINT8,
    description: 'Where to save captured images',
    writable: true,
    enum: {
      'CAMERA': 0x00,
      'HOST': 0x01,
      'BOTH': 0x02,
    }
  },
  
  DIAL_MODE: {
    name: 'DIAL_MODE',
    code: 0xD25A,
    type: DataType.UINT8,
    description: 'Camera dial mode control (controls which setting takes priority between host and camera)',
    writable: true,
    enum: {
      'CAMERA': 0x00,
      'HOST': 0x01,
    }
  },
  
  SHUTTER_BUTTON_CONTROL: {
    name: 'SHUTTER_BUTTON_CONTROL',
    code: 0xD2C1,
    type: DataType.UINT16,
    description: 'Shutter button control property',
    writable: true,
    enum: {
      'RELEASE': 0x0000,
      'FULL_PRESS': 0x0001,
      'HALF_PRESS': 0x0002,
    }
  },
  
  FOCUS_BUTTON_CONTROL: {
    name: 'FOCUS_BUTTON_CONTROL',
    code: 0xD2C2,
    type: DataType.UINT16,
    description: 'Focus button control property',
    writable: true,
    enum: {
      'RELEASE': 0x0000,
      'FULL_PRESS': 0x0001,
      'HALF_PRESS': 0x0002,
    }
  },
  
  LIVE_VIEW_CONTROL: {
    name: 'LIVE_VIEW_CONTROL',
    code: 0xD313,
    type: DataType.UINT16,
    description: 'Live view control property',
    writable: true,
    enum: {
      'DISABLE': 0x0001,
      'ENABLE': 0x0002,
    }
  }
} as const

export type SonyPropertyDefinitions = typeof SonyProperties