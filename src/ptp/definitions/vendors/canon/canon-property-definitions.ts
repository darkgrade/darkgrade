import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { createEnumCodec } from '@ptp/types/codec'
import { PropertyDefinition } from '@ptp/types/property'

const UINT16 = getDatatypeByName('UINT16')!.code

export const CanonAperture = {
    code: 0xd101,
    name: 'CanonAperture',
    description: 'Canon Aperture (f-stop)',
    datatype: UINT16,
    codec: registry =>
        createEnumCodec(
            registry,
            [
                { value: 0x0000, name: 'auto', description: 'Implicit Auto' },
                { value: 0xffff, name: 'auto', description: 'Auto' },
                { value: 0x00b0, name: 'auto', description: 'Auto' },
                { value: 0x0008, name: 'f/1', description: 'f/1.0' },
                { value: 0x000b, name: 'f/1.1', description: 'f/1.1' },
                { value: 0x000c, name: 'f/1.2', description: 'f/1.2' },
                { value: 0x000d, name: 'f/1.2', description: 'f/1.2 (1/3)' },
                { value: 0x0010, name: 'f/1.4', description: 'f/1.4' },
                { value: 0x0013, name: 'f/1.6', description: 'f/1.6' },
                { value: 0x0014, name: 'f/1.8', description: 'f/1.8' },
                { value: 0x0015, name: 'f/1.8', description: 'f/1.8 (1/3)' },
                { value: 0x0018, name: 'f/2', description: 'f/2.0' },
                { value: 0x001b, name: 'f/2.2', description: 'f/2.2' },
                { value: 0x001c, name: 'f/2.5', description: 'f/2.5' },
                { value: 0x001d, name: 'f/2.5', description: 'f/2.5 (1/3)' },
                { value: 0x0020, name: 'f/2.8', description: 'f/2.8' },
                { value: 0x0023, name: 'f/3.2', description: 'f/3.2' },
                { value: 0x0024, name: 'f/3.5', description: 'f/3.5' },
                { value: 0x0025, name: 'f/3.5', description: 'f/3.5 (1/3)' },
                { value: 0x0028, name: 'f/4', description: 'f/4.0' },
                { value: 0x002b, name: 'f/4.5', description: 'f/4.5' },
                { value: 0x002c, name: 'f/4.5', description: 'f/4.5' },
                { value: 0x002d, name: 'f/5.0', description: 'f/5.0' },
                { value: 0x0030, name: 'f/5.6', description: 'f/5.6' },
                { value: 0x0033, name: 'f/6.3', description: 'f/6.3' },
                { value: 0x0034, name: 'f/6.7', description: 'f/6.7' },
                { value: 0x0035, name: 'f/7.1', description: 'f/7.1' },
                { value: 0x0038, name: 'f/8', description: 'f/8.0' },
                { value: 0x003b, name: 'f/9', description: 'f/9.0' },
                { value: 0x003c, name: 'f/9.5', description: 'f/9.5' },
                { value: 0x003d, name: 'f/10', description: 'f/10' },
                { value: 0x0040, name: 'f/11', description: 'f/11' },
                { value: 0x0043, name: 'f/13', description: 'f/13' },
                { value: 0x0044, name: 'f/13', description: 'f/13 (1/3)' },
                { value: 0x0045, name: 'f/14', description: 'f/14' },
                { value: 0x0048, name: 'f/16', description: 'f/16' },
                { value: 0x004b, name: 'f/18', description: 'f/18' },
                { value: 0x004c, name: 'f/19', description: 'f/19' },
                { value: 0x004d, name: 'f/20', description: 'f/20' },
                { value: 0x0050, name: 'f/22', description: 'f/22' },
                { value: 0x0053, name: 'f/25', description: 'f/25' },
                { value: 0x0054, name: 'f/27', description: 'f/27' },
                { value: 0x0055, name: 'f/29', description: 'f/29' },
                { value: 0x0058, name: 'f/32', description: 'f/32' },
                { value: 0x005b, name: 'f/36', description: 'f/36' },
                { value: 0x005c, name: 'f/38', description: 'f/38' },
                { value: 0x005d, name: 'f/40', description: 'f/40' },
                { value: 0x0060, name: 'f/45', description: 'f/45' },
                { value: 0x0063, name: 'f/51', description: 'f/51' },
                { value: 0x0064, name: 'f/54', description: 'f/54' },
                { value: 0x0065, name: 'f/57', description: 'f/57' },
                { value: 0x0068, name: 'f/64', description: 'f/64' },
                { value: 0x006b, name: 'f/72', description: 'f/72' },
                { value: 0x006c, name: 'f/76', description: 'f/76' },
                { value: 0x006d, name: 'f/81', description: 'f/81' },
                { value: 0x0070, name: 'f/91', description: 'f/91' },
            ] as const,
            registry.codecs.uint16
        ),
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
