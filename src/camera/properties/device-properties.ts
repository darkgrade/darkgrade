/**
 * Device property enum for client compatibility
 * Maps to PTP property names in the new V7 architecture
 */
export enum DeviceProperty {
  ISO = 'EXPOSURE_INDEX',
  SHUTTER_SPEED = 'EXPOSURE_TIME',
  APERTURE = 'F_NUMBER',
  EXPOSURE_MODE = 'EXPOSURE_PROGRAM_MODE',
  WHITE_BALANCE = 'WHITE_BALANCE',
  FOCUS_MODE = 'FOCUS_MODE',
}