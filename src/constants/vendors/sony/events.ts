/**
 * Sony events - extending PTP
 * V7 Architecture - Vendor extensions define their own shape
 */

import { PTPEvents } from '../../ptp/events'
import { DataType } from '../../types'

/**
 * Sony events - extending PTP
 */
export const SonyEvents = {
  ...PTPEvents,
  
  // Sony-specific events (0xC201-0xC2FF)
  PROPERTY_CHANGED: {
    code: 0xC201,
    description: 'Sony extended property change notification',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property that changed'
      }
    ]
  },
  
  OBJECT_ADDED_IN_SDRAM: {
    code: 0xC203,
    description: 'New object added to camera SDRAM',
    parameters: [
      {
        name: 'objectHandle',
        type: DataType.UINT32,
        description: 'Handle of new object'
      }
    ]
  },
  
  CAPTURE_STATUS_CHANGED: {
    code: 0xC204,
    description: 'Capture status has changed',
    parameters: [
      {
        name: 'status',
        type: DataType.UINT16,
        description: 'New capture status'
      }
    ]
  },
  
  FOCUS_STATUS_CHANGED: {
    code: 0xC205,
    description: 'Focus status has changed',
    parameters: [
      {
        name: 'focusStatus',
        type: DataType.UINT16,
        description: 'New focus status'
      }
    ]
  },
  
  LIVE_VIEW_STATUS_CHANGED: {
    code: 0xC206,
    description: 'Live view status has changed',
    parameters: [
      {
        name: 'liveViewStatus',
        type: DataType.UINT8,
        description: 'New live view status'
      }
    ]
  },
  
  CARD_STATUS_CHANGED: {
    code: 0xC207,
    description: 'Memory card status has changed',
    parameters: [
      {
        name: 'cardStatus',
        type: DataType.UINT8,
        description: 'New card status'
      }
    ]
  }
} as const

export type SonyEventDefinitions = typeof SonyEvents