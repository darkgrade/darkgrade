/**
 * Sony hardware controls with type validation
 * V7 Architecture - Type-safe with validation
 */

import type { ControlDefinitionShape } from '../../validation-types'

/**
 * Sony hardware controls with type validation
 */
export const SonyControls = {
  // Shutter button controls
  SHUTTER_HALF_PRESS: {
    property: 0xD2C1,
    value: 0x0002,
    description: 'Half-press shutter button (focus)',
    holdable: true
  },
  SHUTTER_FULL_PRESS: {
    property: 0xD2C1,
    value: 0x0001,
    description: 'Full-press shutter button (capture)',
    holdable: false
  },
  SHUTTER_RELEASE: {
    property: 0xD2C1,
    value: 0x0000,
    description: 'Release shutter button',
    holdable: false
  },
  
  // Focus button controls
  FOCUS_HALF_PRESS: {
    property: 0xD2C2,
    value: 0x0002,
    description: 'Start autofocus',
    holdable: true
  },
  FOCUS_FULL_PRESS: {
    property: 0xD2C2,
    value: 0x0001,
    description: 'Lock focus',
    holdable: false
  },
  FOCUS_RELEASE: {
    property: 0xD2C2,
    value: 0x0000,
    description: 'Release focus button',
    holdable: false
  },
  
  // Zoom controls
  ZOOM_IN_START: {
    property: 0xD2D2,
    value: 0x0001,
    description: 'Start zooming in',
    holdable: true
  },
  ZOOM_IN_STOP: {
    property: 0xD2D2,
    value: 0x0000,
    description: 'Stop zooming in',
    holdable: false
  },
  ZOOM_OUT_START: {
    property: 0xD2D3,
    value: 0x0001,
    description: 'Start zooming out',
    holdable: true
  },
  ZOOM_OUT_STOP: {
    property: 0xD2D3,
    value: 0x0000,
    description: 'Stop zooming out',
    holdable: false
  },
  
  // Live view controls
  LIVE_VIEW_ENABLE: {
    property: 0xD313,
    value: 0x0002,
    description: 'Enable live view mode',
    holdable: false
  },
  LIVE_VIEW_DISABLE: {
    property: 0xD313,
    value: 0x0001,
    description: 'Disable live view mode',
    holdable: false
  }
} as const satisfies ControlDefinitionShape

export type SonyControlDefinitions = typeof SonyControls