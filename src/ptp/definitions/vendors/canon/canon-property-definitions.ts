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
    datatype: UINT16,
    codec: registry =>
        createEnumCodec(
            registry,
            [
                { value: 0x0000, name: 'auto', description: 'Auto' },
                { value: 0x0004, name: 'bulb', description: 'Bulb' },
                { value: 0x000c, name: 'bulb', description: 'Bulb' },
                { value: 0x0010, name: '30', description: '30"' },
                { value: 0x0013, name: '25', description: '25"' },
                { value: 0x0014, name: '20.3', description: '20.3" (+1/3)' },
                { value: 0x0015, name: '20', description: '20"' },
                { value: 0x0018, name: '15', description: '15"' },
                { value: 0x001b, name: '13', description: '13"' },
                { value: 0x001c, name: '10', description: '10"' },
                { value: 0x001d, name: '10.3', description: '10.4"' },
                { value: 0x0020, name: '8', description: '8"' },
                { value: 0x0023, name: '6.3', description: '6.3" (+1/3)' },
                { value: 0x0024, name: '6', description: '6"' },
                { value: 0x0025, name: '5', description: '5"' },
                { value: 0x0028, name: '4', description: '4"' },
                { value: 0x002b, name: '3.2', description: '3.2"' },
                { value: 0x002c, name: '3', description: '3"' },
                { value: 0x002d, name: '2.5', description: '2.5"' },
                { value: 0x0030, name: '2', description: '2"' },
                { value: 0x0033, name: '1.6', description: '1.6"' },
                { value: 0x0034, name: '1.5', description: '1.5"' },
                { value: 0x0035, name: '1.3', description: '1.3"' },
                { value: 0x0038, name: '1', description: '1"' },
                { value: 0x003b, name: '0.8', description: '0.8"' },
                { value: 0x003c, name: '0.7', description: '0.7"' },
                { value: 0x003d, name: '0.6', description: '0.6"' },
                { value: 0x0040, name: '0.5', description: '0.5"' },
                { value: 0x0043, name: '0.4', description: '0.4"' },
                { value: 0x0044, name: '0.3', description: '0.3"' },
                { value: 0x0045, name: '0.3', description: '0.3" (1/3)' },
                { value: 0x0048, name: '1/4', description: '1/4' },
                { value: 0x004b, name: '1/5', description: '1/5' },
                { value: 0x004c, name: '1/6', description: '1/6' },
                { value: 0x004d, name: '1/6', description: '1/6 (1/3)' },
                { value: 0x0050, name: '1/8', description: '1/8' },
                { value: 0x0053, name: '1/10', description: '1/10 (1/3)' },
                { value: 0x0054, name: '1/10', description: '1/10' },
                { value: 0x0055, name: '1/13', description: '1/13' },
                { value: 0x0058, name: '1/15', description: '1/15' },
                { value: 0x005b, name: '1/20', description: '1/20 (1/3)' },
                { value: 0x005c, name: '1/20', description: '1/20' },
                { value: 0x005d, name: '1/25', description: '1/25' },
                { value: 0x0060, name: '1/30', description: '1/30' },
                { value: 0x0063, name: '1/40', description: '1/40' },
                { value: 0x0064, name: '1/45', description: '1/45' },
                { value: 0x0065, name: '1/50', description: '1/50' },
                { value: 0x0068, name: '1/60', description: '1/60' },
                { value: 0x006b, name: '1/80', description: '1/80' },
                { value: 0x006c, name: '1/90', description: '1/90' },
                { value: 0x006d, name: '1/100', description: '1/100' },
                { value: 0x0070, name: '1/125', description: '1/125' },
                { value: 0x0073, name: '1/160', description: '1/160' },
                { value: 0x0074, name: '1/180', description: '1/180' },
                { value: 0x0075, name: '1/200', description: '1/200' },
                { value: 0x0078, name: '1/250', description: '1/250' },
                { value: 0x007b, name: '1/320', description: '1/320' },
                { value: 0x007c, name: '1/350', description: '1/350' },
                { value: 0x007d, name: '1/400', description: '1/400' },
                { value: 0x0080, name: '1/500', description: '1/500' },
                { value: 0x0083, name: '1/640', description: '1/640' },
                { value: 0x0084, name: '1/750', description: '1/750' },
                { value: 0x0085, name: '1/800', description: '1/800' },
                { value: 0x0088, name: '1/1000', description: '1/1000' },
                { value: 0x008b, name: '1/1250', description: '1/1250' },
                { value: 0x008c, name: '1/1500', description: '1/1500' },
                { value: 0x008d, name: '1/1600', description: '1/1600' },
                { value: 0x0090, name: '1/2000', description: '1/2000' },
                { value: 0x0093, name: '1/2500', description: '1/2500' },
                { value: 0x0094, name: '1/3000', description: '1/3000' },
                { value: 0x0095, name: '1/3200', description: '1/3200' },
                { value: 0x0098, name: '1/4000', description: '1/4000' },
                { value: 0x009b, name: '1/5000', description: '1/5000' },
                { value: 0x009c, name: '1/6000', description: '1/6000' },
                { value: 0x009d, name: '1/6400', description: '1/6400' },
                { value: 0x00a0, name: '1/8000', description: '1/8000' },
                { value: 0x00a8, name: '1/16000', description: '1/16000' },
            ] as const,
            registry.codecs.uint16
        ),
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

export const CanonIso = {
    code: 0xd103,
    name: 'CanonIso',
    description: 'Canon ISO Sensitivity',
    datatype: UINT16,
    codec: registry =>
        createEnumCodec(
            registry,
            [
                { value: 0xffff, name: 'factory_default', description: 'Factory Default' },
                { value: 0x0000, name: 'auto', description: 'Auto' },
                { value: 0x0001, name: 'auto_iso', description: 'Auto ISO' },
                { value: 0x0028, name: '6', description: 'ISO 6' },
                { value: 0x0030, name: '12', description: 'ISO 12' },
                { value: 0x0038, name: '25', description: 'ISO 25' },
                { value: 0x0040, name: '50', description: 'ISO 50' },
                { value: 0x0043, name: '64', description: 'ISO 64' },
                { value: 0x0045, name: '80', description: 'ISO 80' },
                { value: 0x0048, name: '100', description: 'ISO 100' },
                { value: 0x004b, name: '125', description: 'ISO 125' },
                { value: 0x004d, name: '160', description: 'ISO 160' },
                { value: 0x0050, name: '200', description: 'ISO 200' },
                { value: 0x0053, name: '250', description: 'ISO 250' },
                { value: 0x0055, name: '320', description: 'ISO 320' },
                { value: 0x0058, name: '400', description: 'ISO 400' },
                { value: 0x005b, name: '500', description: 'ISO 500' },
                { value: 0x005d, name: '640', description: 'ISO 640' },
                { value: 0x0060, name: '800', description: 'ISO 800' },
                { value: 0x0063, name: '1000', description: 'ISO 1000' },
                { value: 0x0065, name: '1250', description: 'ISO 1250' },
                { value: 0x0068, name: '1600', description: 'ISO 1600' },
                { value: 0x006b, name: '2000', description: 'ISO 2000' },
                { value: 0x006d, name: '2500', description: 'ISO 2500' },
                { value: 0x0070, name: '3200', description: 'ISO 3200' },
                { value: 0x0073, name: '4000', description: 'ISO 4000' },
                { value: 0x0075, name: '5000', description: 'ISO 5000' },
                { value: 0x0078, name: '6400', description: 'ISO 6400' },
                { value: 0x007b, name: '8000', description: 'ISO 8000' },
                { value: 0x007d, name: '10000', description: 'ISO 10000' },
                { value: 0x0080, name: '12800', description: 'ISO 12800' },
                { value: 0x0083, name: '16000', description: 'ISO 16000' },
                { value: 0x0085, name: '20000', description: 'ISO 20000' },
                { value: 0x0088, name: '25600', description: 'ISO 25600' },
                { value: 0x008b, name: '32000', description: 'ISO 32000' },
                { value: 0x008d, name: '40000', description: 'ISO 40000' },
                { value: 0x0090, name: '51200', description: 'ISO 51200' },
                { value: 0x0093, name: '64000', description: 'ISO 64000' },
                { value: 0x0095, name: '80000', description: 'ISO 80000' },
                { value: 0x0098, name: '102400', description: 'ISO 102400' },
                { value: 0x00a0, name: '204800', description: 'ISO 204800' },
                { value: 0x00a8, name: '409600', description: 'ISO 409600' },
                { value: 0x00b0, name: '819200', description: 'ISO 819200' },
            ] as const,
            registry.codecs.uint16
        ),
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

// validated, https://julianschroden.com/post/2023-08-19-remote-live-view-using-ptp-ip-on-canon-eos-cameras/
export const CanonLiveViewMode = {
    code: 0xd1b0,
    name: 'CanonLiveViewMode',
    description: 'Set live view mode.',
    datatype: UINT16,
    codec: registry =>
        createEnumCodec(
            registry,
            [
                { value: 0x0, name: 'NONE', description: 'None' },
                { value: 0x1, name: 'CAMERA', description: 'Camera' },
                { value: 0x2, name: 'HOST', description: 'Host' },
                { value: 0x3, name: 'CAMERA_AND_HOST', description: 'Camera and Host' },
            ] as const,
            registry.codecs.uint32
        ),
    access: 'GetSet' as const,
} as const satisfies PropertyDefinition

// gphoto2 says this is correct, but it actually starts the recording rather than just setting the destination
// libmtp calls this PTP_DPC_CANON_EOS_EVFRecordStatus
// https://chromium.googlesource.com/chromium/deps/libmtp/+/4f4fad584e9c2735af5131f15b697376a3327de5/src/ptp.h#1655
export const CanonRecordingDestination = {
    code: 0xd1b8,
    name: 'CanonRecordingDestination',
    description: 'Movie recording destination.',
    datatype: UINT16,
    codec: registry =>
        createEnumCodec(
            registry,
            [
                { value: 0x0, name: 'NONE', description: 'None (not recording)' },
                { value: 0x3, name: 'SDRAM', description: 'Camera memory' },
                { value: 0x4, name: 'CARD', description: 'Memory card' },
            ] as const,
            registry.codecs.uint16
        ),
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
    CanonLiveViewMode,
    CanonRecordingDestination,
    CanonLvViewTypeSelect,
    CanonFlashChargingState,
    CanonAloMode,
    CanonOneShotRawOn,
    CanonBrightness,
    CanonAeb,
} as const satisfies { [key: string]: PropertyDefinition }

export type CanonPropertyDef = (typeof canonPropertyRegistry)[keyof typeof canonPropertyRegistry]
