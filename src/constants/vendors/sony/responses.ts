/**
 * Sony response codes - extending PTP
 */

import { ResponseDefinition } from '@constants/types'
import { PTPResponses } from '@constants/ptp/responses'

/**
 * Sony response codes - extending PTP
 */
export const SonyResponses = {
  ...PTPResponses,
  
  // Sony-specific response codes (0xA000-0xAFFF typical range)
  ALREADY_IN_LIVE_VIEW: {
    name: 'ALREADY_IN_LIVE_VIEW',
    code: 0xA001,
    description: 'Camera is already in live view mode',
    recoverable: true
  },
  
  NOT_IN_LIVE_VIEW: {
    name: 'NOT_IN_LIVE_VIEW',
    code: 0xA002,
    description: 'Camera is not in live view mode',
    recoverable: true
  },
  
  LENS_NOT_DETECTED: {
    name: 'LENS_NOT_DETECTED',
    code: 0xA003,
    description: 'No lens detected on camera',
    recoverable: false
  },
  
  CARD_NOT_FORMATTED: {
    name: 'CARD_NOT_FORMATTED',
    code: 0xA004,
    description: 'Memory card is not formatted',
    recoverable: true
  },
  
  BATTERY_LOW: {
    name: 'BATTERY_LOW',
    code: 0xA005,
    description: 'Battery level too low for operation',
    recoverable: true
  },
  
  TEMPERATURE_HIGH: {
    name: 'TEMPERATURE_HIGH',
    code: 0xA006,
    description: 'Camera temperature too high',
    recoverable: true
  },
  
  FOCUS_FAILED: {
    name: 'FOCUS_FAILED',
    code: 0xA007,
    description: 'Autofocus operation failed',
    recoverable: true
  },
  
  EXPOSURE_FAILED: {
    name: 'EXPOSURE_FAILED',
    code: 0xA008,
    description: 'Exposure calculation failed',
    recoverable: true
  },
  
  MODE_NOT_SUPPORTED: {
    name: 'MODE_NOT_SUPPORTED',
    code: 0xA009,
    description: 'Operation not supported in current mode',
    recoverable: false
  },
  
  BUFFER_FULL: {
    name: 'BUFFER_FULL',
    code: 0xA00A,
    description: 'Camera buffer is full',
    recoverable: true
  }
} as const satisfies ResponseDefinition

export type SonyResponseDefinitions = typeof SonyResponses