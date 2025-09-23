/**
 * Sony operations - extending PTP
 * V7 Architecture - Vendor extensions define their own shape
 */

import { PTPOperations } from '@constants/ptp/operations'
import { DataType } from '@constants/types'

/**
 * Sony operations - extending PTP
 * Vendor extensions define their own shape
 */
export const SonyOperations = {
  ...PTPOperations,
  
  // Sony-specific operations (0x9201-0x92FF)
  SDIO_CONNECT: {
    code: 0x9201,
    description: 'Sony-specific SDIO connection handshake',
    parameters: [
      {
        name: 'phase',
        type: DataType.UINT32,
        description: 'Connection phase (1, 2, or 3)'
      },
      {
        name: 'version',
        type: DataType.UINT32,
        description: 'Protocol version'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Connection handshake data'
  },
  
  SDIO_GET_EXT_DEVICE_INFO: {
    code: 0x9202,
    description: 'Get extended device information',
    parameters: [
      {
        name: 'version',
        type: DataType.UINT32,
        description: 'Protocol version'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Extended device info dataset'
  },
  
  SET_DEVICE_PROPERTY_VALUE: {
    code: 0x9205,
    description: 'Sony-specific property setter',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Property code to set'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Property value to set'
  },
  
  CONTROL_DEVICE_PROPERTY: {
    code: 0x9207,
    description: 'Control device hardware buttons and switches',
    parameters: [
      {
        name: 'propertyCode',
        type: DataType.UINT16,
        description: 'Control property code'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'Control value'
  },
  
  GET_ALL_EXT_DEVICE_PROP_INFO: {
    code: 0x9209,
    description: 'Get all device properties in a single call',
    parameters: [
      {
        name: 'version',
        type: DataType.UINT32,
        description: 'Protocol version'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'All device property descriptors'
  },
  
  GET_ALL_DEVICE_PROP_DATA: {
    code: 0x920A,
    description: 'Get all device property values',
    parameters: [],
    hasDataPhase: true,
    dataDescription: 'All device property values'
  },
  
  
  GET_LIVE_VIEW_IMG: {
    code: 0x9219,
    description: 'Get live view image',
    parameters: [],
    hasDataPhase: true,
    dataDescription: 'Live view image data'
  },
  
  SDIO_GET_OSD_IMAGE: {
    code: 0x9238,
    description: 'Get on-screen display image',
    parameters: [
      {
        name: 'handle',
        type: DataType.UINT32,
        description: 'OSD image handle'
      }
    ],
    hasDataPhase: true,
    dataDescription: 'OSD image data'
  }
} as const

export type SonyOperationDefinitions = typeof SonyOperations