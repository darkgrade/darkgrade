import { CanonImageFormatCodec } from '@vendors/canon/datasets/canon-image-format-dataset'
import { CanonMovieFormatCodec } from '@vendors/canon/datasets/canon-movie-format-dataset'
import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { baseCodecs, createEnumCodec, type CodecInstance, type EnumValue, type PTPRegistry } from '@ptp/types/codec'
import { PropertyAccess, PropertyDefinition } from '@ptp/types/property'

const UINT16 = getDatatypeByName('UINT16')!.code
const UINT8 = getDatatypeByName('UINT8')!.code
const UINT32 = getDatatypeByName('UINT32')!.code

/** An enum codec over a fixed-width wire number; names stay literal types. */
export const enumCodec =
    <const Values extends readonly EnumValue<number>[]>(width: 'uint8' | 'uint16' | 'uint32', values: Values) =>
    (registry: PTPRegistry) =>
        createEnumCodec(registry, values, registry.codecs[width])

/** A property read and written as its plain wire number. */
const numericProperty =
    <const Width extends 'uint16' | 'uint32'>(width: Width) =>
    <const Code extends number, const Name extends string, const Access extends PropertyAccess = 'GetSet'>(
        code: Code,
        name: Name,
        description: string,
        access: Access = 'GetSet' as Access
    ) =>
        ({
            code,
            name,
            description,
            datatype: width === 'uint16' ? UINT16 : UINT32,
            codec: baseCodecs[width],
            access,
        }) as const satisfies PropertyDefinition

/** A GetSet property whose wire numbers carry the given names; the datatype defaults to the codec width. */
const enumProperty = <const Code extends number, const Name extends string, const Values extends readonly EnumValue<number>[]>(
    code: Code,
    name: Name,
    description: string,
    width: 'uint8' | 'uint16' | 'uint32',
    values: Values,
    datatype: number = { uint8: UINT8, uint16: UINT16, uint32: UINT32 }[width]
) => ({ code, name, description, datatype, codec: enumCodec(width, values), access: 'GetSet' }) as const satisfies PropertyDefinition

/** A GetSet property decoded by a Canon dataset codec. */
const codecProperty = <const Code extends number, const Name extends string, Value>(
    code: Code,
    name: Name,
    description: string,
    datatype: number,
    codec: (registry: PTPRegistry) => CodecInstance<Value>
) => ({ code, name, description, datatype, codec, access: 'GetSet' }) as const satisfies PropertyDefinition

const uint16Property = numericProperty('uint16')
const uint32Property = numericProperty('uint32')

export const CanonAperture = enumProperty(0xd101, 'CanonAperture', 'Canon Aperture (f-stop)', 'uint16', [
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
])

export const CanonShutterSpeed = enumProperty(0xd102, 'CanonShutterSpeed', 'Canon Shutter Speed', 'uint16', [
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
])

export const CanonIso = enumProperty(0xd103, 'CanonIso', 'Canon ISO Sensitivity', 'uint16', [
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
])

export const CanonExpCompensation = uint16Property(0xd104, 'CanonExpCompensation', 'Canon Exposure Compensation')
export const CanonAutoExposureMode = uint16Property(0xd105, 'CanonAutoExposureMode', 'Canon Auto Exposure Mode')

/**
 * Canon EOS drive mode, named in Slate's canonical drive-mode spelling. Values follow the EDSDK
 * 13.20.21 MultiCamCui sample drivemode_table and libgphoto2 config.c canon_eos_drive_mode
 * (6d5c61ef7687b74fe792e4aeae7fc40f2ad42d88); the EDSDK property ID differs from this PTP code.
 */
export const CanonDriveMode = enumProperty(0xd106, 'CanonDriveMode', 'Canon Drive Mode', 'uint16', [
    { value: 0x00, name: 'Single', description: 'Single shooting' },
    { value: 0x01, name: 'Continuous', description: 'Continuous shooting' },
    { value: 0x04, name: 'Continuous high', description: 'High-speed continuous' },
    { value: 0x05, name: 'Continuous low', description: 'Low-speed continuous' },
    { value: 0x06, name: 'Single soft', description: 'Single silent (soft) shooting' },
    { value: 0x07, name: 'Self-timer continuous', description: 'Self-timer, continuous' },
    { value: 0x10, name: 'Self-timer 10 s', description: 'Self-timer 10 seconds' },
    { value: 0x11, name: 'Self-timer 2 s', description: 'Self-timer 2 seconds' },
    { value: 0x12, name: 'Continuous high+', description: 'High-speed continuous plus' },
    { value: 0x13, name: 'Single silent', description: 'Silent single shooting' },
    { value: 0x14, name: 'Continuous soft', description: 'Silent (soft) continuous shooting' },
    { value: 0x15, name: 'Continuous silent high', description: 'Silent high-speed continuous' },
    { value: 0x16, name: 'Continuous soft low', description: 'Silent (soft) low-speed continuous' },
])

export const CanonMeteringMode = uint16Property(0xd107, 'CanonMeteringMode', 'Canon Metering Mode')

export const CanonFocusMode = enumProperty(0xd108, 'CanonFocusMode', 'Canon Focus Mode', 'uint32', [
    { value: 0x0, name: 'one-shot', description: 'One-Shot AF' },
    { value: 0x1, name: 'ai-servo', description: 'AI Servo AF' },
    { value: 0x2, name: 'ai-focus', description: 'AI Focus AF' },
    { value: 0x3, name: 'manual', description: 'Manual focus' },
])

/**
 * Canon EOS white balance, named in Slate's canonical white-balance spelling. Values follow
 * EDSDK EDSDKTypes.h kEdsWhiteBalance_* and libgphoto2 config.c canon_eos_whitebalance
 * (6d5c61ef7687b74fe792e4aeae7fc40f2ad42d88). Value 7 is undocumented and reads as unrecognized.
 */
export const CanonWhiteBalance = enumProperty(0xd109, 'CanonWhiteBalance', 'Canon White Balance', 'uint8', [
    { value: 0, name: 'Auto', description: 'Auto white balance' },
    { value: 1, name: 'Daylight', description: 'Daylight' },
    { value: 2, name: 'Cloudy', description: 'Cloudy' },
    { value: 3, name: 'Tungsten', description: 'Tungsten light' },
    { value: 4, name: 'Fluorescent', description: 'White fluorescent light' },
    { value: 5, name: 'Flash', description: 'Flash' },
    { value: 6, name: 'Custom', description: 'Custom white balance' },
    { value: 8, name: 'Shade', description: 'Shade' },
    { value: 9, name: 'Color Temperature', description: 'Color temperature' },
    { value: 10, name: 'PC Custom 1', description: 'PC custom white balance 1' },
    { value: 11, name: 'PC Custom 2', description: 'PC custom white balance 2' },
    { value: 12, name: 'PC Custom 3', description: 'PC custom white balance 3' },
    { value: 15, name: 'Custom 2', description: 'Custom white balance 2' },
    { value: 16, name: 'Custom 3', description: 'Custom white balance 3' },
    { value: 18, name: 'Custom 4', description: 'Custom white balance 4' },
    { value: 19, name: 'Custom 5', description: 'Custom white balance 5' },
    { value: 20, name: 'PC Custom 4', description: 'PC custom white balance 4' },
    { value: 21, name: 'PC Custom 5', description: 'PC custom white balance 5' },
    { value: 23, name: 'Auto White Priority', description: 'Auto white balance, white priority' },
])

export const CanonWhiteBalanceAdjustA = uint16Property(0xd10b, 'CanonWhiteBalanceAdjustA', 'Canon White Balance Adjust A')
export const CanonWhiteBalanceAdjustB = uint16Property(0xd10c, 'CanonWhiteBalanceAdjustB', 'Canon White Balance Adjust B')
export const CanonWhiteBalanceXA = uint16Property(0xd10d, 'CanonWhiteBalanceXA', 'Canon White Balance X A')
export const CanonWhiteBalanceXB = uint16Property(0xd10e, 'CanonWhiteBalanceXB', 'Canon White Balance X B')
export const CanonColorSpace = uint16Property(0xd10f, 'CanonColorSpace', 'Canon Color Space')

/**
 * Canon EOS Picture Style, named in Slate's canonical look spelling. Values follow EDSDK
 * EDSDKTypes.h kEdsPictureStyle_* and libgphoto2 config.c canon_eos_picturestyle
 * (6d5c61ef7687b74fe792e4aeae7fc40f2ad42d88).
 */
export const CanonPictureStyle = enumProperty(0xd110, 'CanonPictureStyle', 'Canon Picture Style', 'uint16', [
    { value: 0x81, name: 'Standard', description: 'Standard' },
    { value: 0x82, name: 'Portrait', description: 'Portrait' },
    { value: 0x83, name: 'Landscape', description: 'Landscape' },
    { value: 0x84, name: 'Neutral', description: 'Neutral' },
    { value: 0x85, name: 'Faithful', description: 'Faithful' },
    { value: 0x86, name: 'Monochrome', description: 'Monochrome' },
    { value: 0x87, name: 'Auto', description: 'Auto' },
    { value: 0x88, name: 'Fine detail', description: 'Fine Detail' },
    { value: 0x21, name: 'User defined 1', description: 'User defined 1' },
    { value: 0x22, name: 'User defined 2', description: 'User defined 2' },
    { value: 0x23, name: 'User defined 3', description: 'User defined 3' },
    { value: 0x41, name: 'PC 1', description: 'Computer-registered style 1' },
    { value: 0x42, name: 'PC 2', description: 'Computer-registered style 2' },
    { value: 0x43, name: 'PC 3', description: 'Computer-registered style 3' },
])

export const CanonAutoPowerOff = uint16Property(0xd114, 'CanonAutoPowerOff', 'Canon Auto Power Off')
export const CanonModelId = uint32Property(0xd116, 'CanonModelId', 'Canon Model ID', 'Get')
export const CanonAvailableShots = uint16Property(0xd11b, 'CanonAvailableShots', 'Canon Available Shots', 'Get')

export const CanonImageFormat = codecProperty(0xd120, 'CanonImageFormat', 'Canon still-image recording format', UINT16, registry => new CanonImageFormatCodec(registry))

export const CanonImageFormatSd = codecProperty(0xd122, 'CanonImageFormatSd', 'Canon still-image recording format for the SD card', UINT16, registry => new CanonImageFormatCodec(registry))

export const CanonAeModeDial = uint16Property(0xd138, 'CanonAeModeDial', 'Canon AE Mode Dial', 'Get')
export const CanonPictureStyleExStandard = uint16Property(0xd157, 'CanonPictureStyleExStandard', 'Canon Picture Style Ex Standard')
export const CanonExposureSimMode = uint16Property(0xd1b7, 'CanonExposureSimMode', 'Canon Exposure Simulation Mode')

/** EDSDK 13.20.21, section 5.2.105; PTP wire mapping verified in the SDK and EOS 80D. */
export const CanonMovieSoundRecording = enumProperty(0xd195, 'CanonMovieSoundRecording', 'Sound recorded in the camera movie', 'uint32', [
    { value: 0, name: 'camera-specific-0', description: 'R6 Mark III reports this value with choices 0/1; audio semantics require model-specific verification' },
    { value: 1, name: 'Off', description: 'Sound recording disabled' },
    { value: 2, name: 'On', description: 'Sound recorded at an automatic level' },
    { value: 3, name: 'On (manual level)', description: 'Sound recorded at a manually set level' },
])

export const CanonMovieServoAutofocus = enumProperty(0xd179, 'CanonMovieServoAutofocus', 'Canon Movie Servo AF', 'uint32', [
    { value: 0, name: 'off', description: 'Movie Servo AF off' },
    { value: 1, name: 'on', description: 'Movie Servo AF on' },
])

// validated, https://julianschroden.com/post/2023-08-19-remote-live-view-using-ptp-ip-on-canon-eos-cameras/
export const CanonLiveViewMode = enumProperty(0xd1b0, 'CanonLiveViewMode', 'Set live view mode.', 'uint32', [
    { value: 0x0, name: 'NONE', description: 'None' },
    { value: 0x1, name: 'CAMERA', description: 'Camera' },
    { value: 0x2, name: 'HOST', description: 'Host' },
    { value: 0x3, name: 'CAMERA_AND_HOST', description: 'Camera and Host' },
], UINT16)

/**
 * EOS PTP CaptureDestination, distinct from the Record command at 0xd1b8 (libmtp PTP_DPC_CANON_EOS_EVFRecordStatus,
 * https://chromium.googlesource.com/chromium/deps/libmtp/+/4f4fad584e9c2735af5131f15b697376a3327de5/src/ptp.h#1655).
 * Source: libgphoto2 camlibs/ptp2/config.c camera_canon_eos_update_capture_target. Card values come from the
 * camera's enumeration; 4 denotes host memory.
 */
export const CanonCaptureDestination = uint32Property(0xd11c, 'CanonCaptureDestination', 'Capture storage target (camera-advertised card values or host memory).')

export const CanonRecordingDestination = enumProperty(0xd1b8, 'CanonRecordingDestination', 'Movie recording destination.', 'uint16', [
    { value: 0x0, name: 'NONE', description: 'None (not recording)' },
    { value: 0x3, name: 'SDRAM', description: 'Camera memory' },
    { value: 0x4, name: 'CARD', description: 'Memory card' },
])

export const CanonLvViewTypeSelect = uint16Property(0xd1bc, 'CanonLvViewTypeSelect', 'Canon Live View Type Select')
export const CanonMovieSize = uint32Property(0xd1bb, 'CanonMovieSize', 'Canon movie recording size/format (camera-specific raw value)')

export const CanonMovieFormat = codecProperty(0xd1cd, 'CanonMovieFormat', 'Canon movie resolution, frame rate, container, and compression', UINT32, registry => new CanonMovieFormatCodec(registry))

export const CanonContinuousAutofocus = enumProperty(0xd1c9, 'CanonContinuousAutofocus', 'Canon continuous autofocus mode', 'uint32', [
    { value: 0, name: 'off', description: 'Continuous autofocus off' },
    { value: 1, name: 'on', description: 'Continuous autofocus on' },
])

export const CanonFlashChargingState = uint16Property(0xd1c0, 'CanonFlashChargingState', 'Canon Flash Charging State', 'Get')
export const CanonAloMode = uint16Property(0xd1c1, 'CanonAloMode', 'Canon ALO Mode')
export const CanonOneShotRawOn = uint16Property(0xd1c3, 'CanonOneShotRawOn', 'Canon One Shot RAW On')
export const CanonBrightness = uint16Property(0xd1d5, 'CanonBrightness', 'Canon Brightness')
export const CanonAeb = uint16Property(0xd1d9, 'CanonAeb', 'Canon Auto Exposure Bracketing')
export const CanonNetworkServerRegion = uint32Property(0xd14a, 'CanonNetworkServerRegion', 'Canon network server region', 'Get')
export const CanonNetworkCommunicationMode = uint32Property(0xd175, 'CanonNetworkCommunicationMode', 'Canon network communication mode')
export const CanonWftStatus = uint32Property(0xd1a3, 'CanonWftStatus', 'Canon wireless file transmitter status', 'Get')
export const CanonColorTemperature = uint32Property(0xd10a, 'CanonColorTemperature', 'White-balance color temperature in kelvin.')

export const CanonLiveViewAutofocusMode = enumProperty(0xd1ba, 'CanonLiveViewAutofocusMode', 'Live-view AF area/system (EDSDK Evf_AFMode).', 'uint32', [
    { value: 0, name: 'quick', description: 'Quick AF' },
    { value: 1, name: 'live', description: 'Live AF' },
    { value: 2, name: 'face', description: 'Face detection' },
    { value: 3, name: 'multi', description: 'Multi-point' },
    { value: 4, name: 'zone', description: 'Zone' },
    { value: 5, name: 'expand-cross', description: 'Cross expansion' },
    { value: 6, name: 'expand-around', description: 'Surround expansion' },
    { value: 7, name: 'large-zone-horizontal', description: 'Large horizontal zone' },
    { value: 8, name: 'large-zone-vertical', description: 'Large vertical zone' },
    { value: 9, name: 'tracking', description: 'Tracking' },
    { value: 10, name: 'spot', description: 'Spot' },
    { value: 11, name: 'flexible-zone-1', description: 'Flexible zone 1' },
    { value: 12, name: 'flexible-zone-2', description: 'Flexible zone 2' },
    { value: 13, name: 'flexible-zone-3', description: 'Flexible zone 3' },
    { value: 14, name: 'whole-area', description: 'Whole area' },
    { value: 15, name: 'spot-without-tracking', description: 'Spot without tracking' },
    { value: 16, name: 'one-point-without-tracking', description: 'One point without tracking' },
    { value: 17, name: 'expand-cross-without-tracking', description: 'Cross expansion without tracking' },
    { value: 18, name: 'expand-around-without-tracking', description: 'Surround expansion without tracking' },
])

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
    CanonColorTemperature,
    CanonLiveViewAutofocusMode,
    CanonWhiteBalanceAdjustA,
    CanonWhiteBalanceAdjustB,
    CanonWhiteBalanceXA,
    CanonWhiteBalanceXB,
    CanonColorSpace,
    CanonPictureStyle,
    CanonAutoPowerOff,
    CanonModelId,
    CanonAvailableShots,
    CanonImageFormat,
    CanonImageFormatSd,
    CanonAeModeDial,
    CanonPictureStyleExStandard,
    CanonExposureSimMode,
    CanonMovieSoundRecording,
    CanonMovieServoAutofocus,
    CanonLiveViewMode,
    CanonRecordingDestination,
    CanonCaptureDestination,
    CanonLvViewTypeSelect,
    CanonMovieSize,
    CanonMovieFormat,
    CanonContinuousAutofocus,
    CanonFlashChargingState,
    CanonAloMode,
    CanonOneShotRawOn,
    CanonBrightness,
    CanonAeb,
    CanonNetworkServerRegion,
    CanonNetworkCommunicationMode,
    CanonWftStatus,
} as const satisfies { [key: string]: PropertyDefinition }

export type CanonPropertyDef = (typeof canonPropertyRegistry)[keyof typeof canonPropertyRegistry]
