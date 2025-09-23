/**
 * Common property value enums
 * V7 Architecture - Type-safe with validation
 */

/**
 * Exposure modes
 */
export enum ExposureMode {
  AUTO = 'auto',
  PROGRAM = 'program',
  APERTURE_PRIORITY = 'aperturePriority',
  SHUTTER_PRIORITY = 'shutterPriority',
  MANUAL = 'manual',
  BULB = 'bulb',
  SCENE = 'scene',
}

/**
 * Focus modes
 */
export enum FocusMode {
  MANUAL = 'manual',
  AUTO_SINGLE = 'autoSingle',
  AUTO_CONTINUOUS = 'autoContinuous',
  AUTO_AUTOMATIC = 'autoAutomatic',
  DMF = 'dmf',
  POWER_FOCUS = 'powerFocus',
}

/**
 * White balance modes
 */
export enum WhiteBalanceMode {
  AUTO = 'auto',
  DAYLIGHT = 'daylight',
  CLOUDY = 'cloudy',
  SHADE = 'shade',
  TUNGSTEN = 'tungsten',
  FLUORESCENT = 'fluorescent',
  FLASH = 'flash',
  CUSTOM = 'custom',
  KELVIN = 'kelvin',
}

/**
 * Drive modes
 */
export enum DriveMode {
  SINGLE = 'single',
  CONTINUOUS_LOW = 'continuousLow',
  CONTINUOUS_HIGH = 'continuousHigh',
  SELF_TIMER_2 = 'selfTimer2',
  SELF_TIMER_10 = 'selfTimer10',
  BRACKETING = 'bracketing',
}

/**
 * Image quality modes
 */
export enum ImageQuality {
  RAW = 'raw',
  FINE = 'fine',
  NORMAL = 'normal',
  BASIC = 'basic',
  RAW_JPEG_FINE = 'rawJpegFine',
  RAW_JPEG_NORMAL = 'rawJpegNormal',
  RAW_JPEG_BASIC = 'rawJpegBasic',
}

/**
 * Flash modes
 */
export enum FlashMode {
  OFF = 'off',
  AUTO = 'auto',
  FILL = 'fill',
  RED_EYE = 'redEye',
  SLOW_SYNC = 'slowSync',
  REAR_SYNC = 'rearSync',
  WIRELESS = 'wireless',
}

/**
 * Metering modes
 */
export enum MeteringMode {
  MULTI = 'multi',
  CENTER_WEIGHTED = 'centerWeighted',
  SPOT = 'spot',
  ENTIRE_SCREEN_AVG = 'entireScreenAvg',
  HIGHLIGHT = 'highlight',
}

/**
 * AF area modes
 */
export enum AFAreaMode {
  WIDE = 'wide',
  ZONE = 'zone',
  CENTER = 'center',
  FLEXIBLE_SPOT = 'flexibleSpot',
  EXPANDED_FLEXIBLE_SPOT = 'expandedFlexibleSpot',
  TRACKING = 'tracking',
}

/**
 * Color space modes
 */
export enum ColorSpace {
  SRGB = 'sRGB',
  ADOBE_RGB = 'adobeRGB',
  PRO_PHOTO = 'proPhoto',
}