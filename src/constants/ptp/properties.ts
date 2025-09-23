/**
 * PTP standard property definitions with type validation
 * V7 Architecture - Type-safe with validation
 */

import { DataType, PropertyForm } from '@constants/types'
import type { PropertyDefinitionShape } from '@constants/property-types'
import type { HexCode } from '@constants/types'

/**
 * PTP standard property definitions with type validation
 */
export const PTPProperties = {
  UNDEFINED: {
    name: 'UNDEFINED',
    code: 0x5000,
    type: DataType.UINT16,
    description: 'Undefined device property',
    writable: false
  },
  
  BATTERY_LEVEL: {
    name: 'BATTERY_LEVEL',
    code: 0x5001,
    type: DataType.UINT8,
    unit: '%',
    description: 'Current battery charge level as a percentage',
    writable: false,
    descriptor: {
      form: PropertyForm.RANGE,
      min: 0,
      max: 100,
      step: 1
    }
  },
  
  FUNCTIONAL_MODE: {
    name: 'FUNCTIONAL_MODE',
    code: 0x5002,
    type: DataType.UINT16,
    description: 'Current functional mode of the device',
    writable: true,
    enum: {
      'STANDARD': 0x0000,
      'SLEEP': 0x0001,
    }
  },
  
  IMAGE_SIZE: {
    name: 'IMAGE_SIZE',
    code: 0x5003,
    type: DataType.STRING,
    description: 'Image size/resolution setting',
    writable: true
  },
  
  COMPRESSION_SETTING: {
    name: 'COMPRESSION_SETTING',
    code: 0x5004,
    type: DataType.UINT8,
    description: 'Image compression quality setting',
    writable: true,
    descriptor: {
      form: PropertyForm.RANGE,
      min: 0,
      max: 10,
      step: 1
    }
  },
  
  WHITE_BALANCE: {
    name: 'WHITE_BALANCE',
    code: 0x5005,
    type: DataType.UINT16,
    description: 'White balance setting for color temperature adjustment',
    writable: true,
    enum: {
      'MANUAL': 0x0001,
      'AUTO': 0x0002,
      'ONE_PUSH_AUTO': 0x0003,
      'DAYLIGHT': 0x0004,
      'FLUORESCENT': 0x0005,
      'TUNGSTEN': 0x0006,
      'FLASH': 0x0007,
      'CLOUDY': 0x8010,
      'SHADE': 0x8011,
    }
  },
  
  RGB_GAIN: {
    name: 'RGB_GAIN',
    code: 0x5006,
    type: DataType.STRING,
    description: 'RGB gain values for fine color adjustment',
    writable: true
  },
  
  F_NUMBER: {
    name: 'F_NUMBER',
    code: 0x5007,
    type: DataType.UINT16,
    unit: 'f-stop',
    description: 'Aperture f-number for exposure control',
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
  
  FOCAL_LENGTH: {
    name: 'FOCAL_LENGTH',
    code: 0x5008,
    type: DataType.UINT32,
    unit: 'mm',
    description: 'Lens focal length in millimeters',
    writable: false
  },
  
  FOCUS_DISTANCE: {
    name: 'FOCUS_DISTANCE',
    code: 0x5009,
    type: DataType.UINT16,
    unit: 'mm',
    description: 'Focus distance from the camera sensor',
    writable: true
  },
  
  FOCUS_MODE: {
    name: 'FOCUS_MODE',
    code: 0x500A,
    type: DataType.UINT16,
    description: 'Focus mode for autofocus behavior',
    writable: true,
    enum: {
      'MANUAL': 0x0001,
      'AUTO_SINGLE': 0x0002,
      'AUTO_CONTINUOUS': 0x0003,
    }
  },
  
  EXPOSURE_METERING_MODE: {
    name: 'EXPOSURE_METERING_MODE',
    code: 0x500B,
    type: DataType.UINT16,
    description: 'Exposure metering mode for light measurement',
    writable: true,
    enum: {
      'AVERAGE': 0x0001,
      'CENTER_WEIGHTED': 0x0002,
      'MULTI_SPOT': 0x0003,
      'CENTER_SPOT': 0x0004,
    }
  },
  
  FLASH_MODE: {
    name: 'FLASH_MODE',
    code: 0x500C,
    type: DataType.UINT16,
    description: 'Flash firing mode',
    writable: true,
    enum: {
      'AUTO': 0x0001,
      'OFF': 0x0002,
      'FILL': 0x0003,
      'RED_EYE_AUTO': 0x0004,
      'RED_EYE_FILL': 0x0005,
      'EXTERNAL_SYNC': 0x0006,
    }
  },
  
  EXPOSURE_TIME: {
    name: 'EXPOSURE_TIME',
    code: 0x500D,
    type: DataType.UINT32,
    unit: 'microseconds',
    description: 'Shutter speed/exposure time in microseconds',
    writable: true
  },
  
  EXPOSURE_PROGRAM_MODE: {
    name: 'EXPOSURE_PROGRAM_MODE',
    code: 0x500E,
    type: DataType.UINT16,
    description: 'Exposure program mode',
    writable: true,
    enum: {
      'MANUAL': 0x0001,
      'AUTO': 0x0002,
      'APERTURE_PRIORITY': 0x0003,
      'SHUTTER_PRIORITY': 0x0004,
      'CREATIVE': 0x0005,
      'ACTION': 0x0006,
      'PORTRAIT': 0x0007,
    }
  },
  
  EXPOSURE_INDEX: {
    name: 'EXPOSURE_INDEX',
    code: 0x500F,
    type: DataType.UINT16,
    unit: 'ISO',
    description: 'ISO sensitivity value',
    writable: true
  },
  
  EXPOSURE_BIAS_COMPENSATION: {
    name: 'EXPOSURE_BIAS_COMPENSATION',
    code: 0x5010,
    type: DataType.INT16,
    unit: 'EV',
    description: 'Exposure compensation in EV steps',
    writable: true,
    descriptor: {
      form: PropertyForm.RANGE,
      min: -5000,
      max: 5000,
      step: 100
    }
  },
  
  DATE_TIME: {
    name: 'DATE_TIME',
    code: 0x5011,
    type: DataType.STRING,
    description: 'Camera date and time setting',
    writable: true
  },
  
  CAPTURE_DELAY: {
    name: 'CAPTURE_DELAY',
    code: 0x5012,
    type: DataType.UINT32,
    unit: 'milliseconds',
    description: 'Self-timer delay in milliseconds',
    writable: true
  },
  
  STILL_CAPTURE_MODE: {
    name: 'STILL_CAPTURE_MODE',
    code: 0x5013,
    type: DataType.UINT16,
    description: 'Still image capture mode',
    writable: true,
    enum: {
      'SINGLE': 0x0001,
      'BURST': 0x0002,
      'TIMELAPSE': 0x0003,
    }
  },
  
  CONTRAST: {
    name: 'CONTRAST',
    code: 0x5014,
    type: DataType.INT8,
    description: 'Image contrast adjustment',
    writable: true,
    descriptor: {
      form: PropertyForm.RANGE,
      min: -100,
      max: 100,
      step: 1
    }
  },
  
  SHARPNESS: {
    name: 'SHARPNESS',
    code: 0x5015,
    type: DataType.INT8,
    description: 'Image sharpness adjustment',
    writable: true,
    descriptor: {
      form: PropertyForm.RANGE,
      min: -100,
      max: 100,
      step: 1
    }
  },
  
  DIGITAL_ZOOM: {
    name: 'DIGITAL_ZOOM',
    code: 0x5016,
    type: DataType.UINT8,
    unit: 'x',
    description: 'Digital zoom ratio',
    writable: true
  },
  
  EFFECT_MODE: {
    name: 'EFFECT_MODE',
    code: 0x5017,
    type: DataType.UINT16,
    description: 'Special effect mode',
    writable: true,
    enum: {
      'OFF': 0x0000,
      'MONO': 0x0001,
      'SEPIA': 0x0002,
    }
  },
  
  BURST_NUMBER: {
    name: 'BURST_NUMBER',
    code: 0x5018,
    type: DataType.UINT16,
    description: 'Number of images in burst mode',
    writable: true
  },
  
  BURST_INTERVAL: {
    name: 'BURST_INTERVAL',
    code: 0x5019,
    type: DataType.UINT32,
    unit: 'milliseconds',
    description: 'Interval between burst shots',
    writable: true
  },
  
  TIMELAPSE_NUMBER: {
    name: 'TIMELAPSE_NUMBER',
    code: 0x501A,
    type: DataType.UINT16,
    description: 'Number of images in timelapse sequence',
    writable: true
  },
  
  TIMELAPSE_INTERVAL: {
    name: 'TIMELAPSE_INTERVAL',
    code: 0x501B,
    type: DataType.UINT32,
    unit: 'milliseconds',
    description: 'Interval between timelapse shots',
    writable: true
  },
  
  FOCUS_METERING_MODE: {
    name: 'FOCUS_METERING_MODE',
    code: 0x501C,
    type: DataType.UINT16,
    description: 'Focus point selection mode',
    writable: true,
    enum: {
      'CENTER': 0x0001,
      'MULTI_SPOT': 0x0002,
      'SINGLE_SPOT': 0x0003,
    }
  },
  
  UPLOAD_URL: {
    name: 'UPLOAD_URL',
    code: 0x501D,
    type: DataType.STRING,
    description: 'URL for automatic image upload',
    writable: true
  },
  
  ARTIST: {
    name: 'ARTIST',
    code: 0x501E,
    type: DataType.STRING,
    description: 'Artist name for metadata',
    writable: true
  },
  
  COPYRIGHT_INFO: {
    name: 'COPYRIGHT_INFO',
    code: 0x501F,
    type: DataType.STRING,
    description: 'Copyright information for metadata',
    writable: true
  }
} as const satisfies PropertyDefinitionShape

export type PTPPropertyDefinitions = typeof PTPProperties