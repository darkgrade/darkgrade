import { PropertyDefinition } from '@ptp/types/property'

export const CanonAperture = {
    code: 0xd101,
    name: 'CanonAperture',
    description: 'Canon Aperture (f-stop)',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonShutterSpeed = {
    code: 0xd102,
    name: 'CanonShutterSpeed',
    description: 'Canon Shutter Speed',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonIso = {
    code: 0xd103,
    name: 'CanonIso',
    description: 'Canon ISO Sensitivity',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonExpCompensation = {
    code: 0xd104,
    name: 'CanonExpCompensation',
    description: 'Canon Exposure Compensation',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonAutoExposureMode = {
    code: 0xd105,
    name: 'CanonAutoExposureMode',
    description: 'Canon Auto Exposure Mode',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonDriveMode = {
    code: 0xd106,
    name: 'CanonDriveMode',
    description: 'Canon Drive Mode',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonMeteringMode = {
    code: 0xd107,
    name: 'CanonMeteringMode',
    description: 'Canon Metering Mode',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonFocusMode = {
    code: 0xd108,
    name: 'CanonFocusMode',
    description: 'Canon Focus Mode',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonWhiteBalance = {
    code: 0xd109,
    name: 'CanonWhiteBalance',
    description: 'Canon White Balance',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonWhiteBalanceAdjustA = {
    code: 0xd10b,
    name: 'CanonWhiteBalanceAdjustA',
    description: 'Canon White Balance Adjust A',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonWhiteBalanceAdjustB = {
    code: 0xd10c,
    name: 'CanonWhiteBalanceAdjustB',
    description: 'Canon White Balance Adjust B',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonWhiteBalanceXA = {
    code: 0xd10d,
    name: 'CanonWhiteBalanceXA',
    description: 'Canon White Balance X A',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonWhiteBalanceXB = {
    code: 0xd10e,
    name: 'CanonWhiteBalanceXB',
    description: 'Canon White Balance X B',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonColorSpace = {
    code: 0xd10f,
    name: 'CanonColorSpace',
    description: 'Canon Color Space',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonPictureStyle = {
    code: 0xd110,
    name: 'CanonPictureStyle',
    description: 'Canon Picture Style',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonAutoPowerOff = {
    code: 0xd114,
    name: 'CanonAutoPowerOff',
    description: 'Canon Auto Power Off',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonModelId = {
    code: 0xd116,
    name: 'CanonModelId',
    description: 'Canon Model ID',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'Get' as const,
} as const satisfies PropertyDefinition

export const CanonAvailableShots = {
    code: 0xd11b,
    name: 'CanonAvailableShots',
    description: 'Canon Available Shots',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'Get' as const,
} as const satisfies PropertyDefinition

export const CanonAeModeDial = {
    code: 0xd138,
    name: 'CanonAeModeDial',
    description: 'Canon AE Mode Dial',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'Get' as const,
} as const satisfies PropertyDefinition

export const CanonPictureStyleExStandard = {
    code: 0xd157,
    name: 'CanonPictureStyleExStandard',
    description: 'Canon Picture Style Ex Standard',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonExposureSimMode = {
    code: 0xd1b7,
    name: 'CanonExposureSimMode',
    description: 'Canon Exposure Simulation Mode',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonLvViewTypeSelect = {
    code: 0xd1bc,
    name: 'CanonLvViewTypeSelect',
    description: 'Canon Live View Type Select',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonFlashChargingState = {
    code: 0xd1c0,
    name: 'CanonFlashChargingState',
    description: 'Canon Flash Charging State',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'Get' as const,
} as const satisfies PropertyDefinition

export const CanonAloMode = {
    code: 0xd1c1,
    name: 'CanonAloMode',
    description: 'Canon ALO Mode',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonOneShotRawOn = {
    code: 0xd1c3,
    name: 'CanonOneShotRawOn',
    description: 'Canon One Shot RAW On',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonBrightness = {
    code: 0xd1d5,
    name: 'CanonBrightness',
    description: 'Canon Brightness',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonAeb = {
    code: 0xd1d9,
    name: 'CanonAeb',
    description: 'Canon Auto Exposure Bracketing',
    datatype: 0x0004,
    codec: registry => registry.codecs.uint16,
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const canonPropertyRegistry = {
    CanonAperture,
    CanonShutterSpeed,
    CanonIso,
    CanonExpCompensation,
    CanonAutoExposureMode,
    CanonDriveMode,
    CanonMeteringMode,
    CanonFocusMode,
    CanonWhiteBalance,
    CanonWhiteBalanceAdjustA,
    CanonWhiteBalanceAdjustB,
    CanonWhiteBalanceXA,
    CanonWhiteBalanceXB,
    CanonColorSpace,
    CanonPictureStyle,
    CanonAutoPowerOff,
    CanonModelId,
    CanonAvailableShots,
    CanonAeModeDial,
    CanonPictureStyleExStandard,
    CanonExposureSimMode,
    CanonLvViewTypeSelect,
    CanonFlashChargingState,
    CanonAloMode,
    CanonOneShotRawOn,
    CanonBrightness,
    CanonAeb,
} as const satisfies { [key: string]: PropertyDefinition }

export type CanonPropertyDef = (typeof canonPropertyRegistry)[keyof typeof canonPropertyRegistry]
