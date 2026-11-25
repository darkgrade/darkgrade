import { getDatatypeByName } from '@ptp/definitions/datatype-definitions'
import { baseCodecs, createEnumCodec, CustomCodec } from '@ptp/types/codec'
import { PropertyDefinition, type PropertyAccess } from '@ptp/types/property'

const UNDEF = getDatatypeByName('UNDEF')!.code
const UINT16 = getDatatypeByName('UINT16')!.code
const UINT32 = getDatatypeByName('UINT32')!.code

const scalarCodecs = {
    UINT8: baseCodecs.uint8,
    INT16: baseCodecs.int16,
    UINT16: baseCodecs.uint16,
    UINT32: baseCodecs.uint32,
    STR: baseCodecs.string,
} as const

/** A property holding one PTP scalar, decoded by its datatype's own codec. */
function scalar<
    const Code extends number,
    const Name extends string,
    const Description extends string,
    Type extends keyof typeof scalarCodecs,
    const Access extends PropertyAccess,
>(code: Code, name: Name, description: Description, type: Type, access: Access) {
    return { code, name, description, datatype: getDatatypeByName(type)!.code, access, codec: scalarCodecs[type] }
}

/** PIMA 15740 (PTP) FocusMode values; vendors extend it from 0x8000 in their own registries. */
export const STANDARD_FOCUS_MODES = [
    { value: 0x0001, name: 'Manual', description: 'Manual focus' },
    { value: 0x0002, name: 'Automatic', description: 'Automatic focus' },
    { value: 0x0003, name: 'Automatic Macro', description: 'Automatic focus, close-up' },
] as const

// PTP ExposureProgramMode (ISO 15740) values, verified against the Sony Camera
// Remote SDK on the ILCE-6700 (raw 1 = Manual). Unknown/vendor modes decode to a
// readable "Mode 0x…" rather than throwing, so cameras in extended modes still report.
const EXPOSURE_PROGRAM_NAMES: Record<number, string> = {
    0x0001: 'Manual',
    0x0002: 'Program Auto',
    0x0003: 'Aperture Priority',
    0x0004: 'Shutter Priority',
    0x0005: 'Program Creative',
    0x0006: 'Program Action',
    0x0007: 'Portrait',
    0x8000: 'Auto',
    0x8001: 'Auto Plus',
}

export const genericPropertyRegistry = {
    Undefined: {
        code: 0x5000,
        name: 'Undefined',
        description: 'Undefined property',
        datatype: UNDEF,
        access: 'Get',
        codec: baseCodecs.uint16,
    },
    BatteryLevel: scalar(0x5001, 'BatteryLevel', 'Battery level percentage', 'UINT8', 'Get'),
    FunctionalMode: scalar(0x5002, 'FunctionalMode', 'Functional mode of device', 'UINT16', 'GetSet'),
    ImageSize: scalar(0x5003, 'ImageSize', 'Image dimensions', 'STR', 'GetSet'),
    CompressionSetting: scalar(0x5004, 'CompressionSetting', 'Compression level', 'UINT8', 'GetSet'),
    /**
     * ISO 15740 WhiteBalance values, named in Slate's canonical white-balance spelling. Vendor values
     * (0x8000 and up) belong to each vendor's own definition; here they read as unrecognized.
     */
    WhiteBalance: {
        code: 0x5005,
        name: 'WhiteBalance',
        description: 'White balance setting',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry =>
            createEnumCodec(
                registry,
                [
                    { value: 0x0001, name: 'Custom', description: 'Manual (preset) white balance' },
                    { value: 0x0002, name: 'Auto', description: 'Automatic white balance' },
                    { value: 0x0003, name: 'One-push Auto', description: 'One-push automatic white balance' },
                    { value: 0x0004, name: 'Daylight', description: 'Daylight' },
                    { value: 0x0005, name: 'Fluorescent', description: 'Fluorescent' },
                    { value: 0x0006, name: 'Tungsten', description: 'Tungsten' },
                    { value: 0x0007, name: 'Flash', description: 'Flash' },
                ] as const,
                registry.codecs.uint16
            ),
    },
    RGBGain: scalar(0x5006, 'RGBGain', 'RGB gain values', 'STR', 'GetSet'),
    FNumber: {
        code: 0x5007,
        name: 'FNumber',
        description: 'F-stop number (aperture)',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry =>
            new (class extends CustomCodec<string> {
                encode(value: string): Uint8Array {
                    const uint16 = this.baseCodecs.uint16
                    // Parse strings like "f/2.8", "2.8", "F2.8"
                    const numericValue = parseFloat(value.replace(/[^\d.]/g, ''))
                    return uint16.encode(Math.round(numericValue * 100))
                }
                decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
                    const uint16 = this.baseCodecs.uint16
                    const result = uint16.decode(buffer, offset)
                    // Hundredths without trailing zeros (f/4, f/2.8, f/0.95): never rounded to one decimal.
                    return { value: `f/${result.value / 100}`, bytesRead: result.bytesRead }
                }
            })(registry),
    },
    FocalLength: scalar(0x5008, 'FocalLength', 'Focal length in mm', 'UINT32', 'GetSet'),
    FocusDistance: scalar(0x5009, 'FocusDistance', 'Focus distance in mm', 'UINT16', 'GetSet'),
    FocusMode: {
        code: 0x500a,
        name: 'FocusMode',
        description: 'Focus mode',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry => createEnumCodec(registry, STANDARD_FOCUS_MODES, registry.codecs.uint16),
    },
    ExposureMeteringMode: scalar(0x500b, 'ExposureMeteringMode', 'Exposure metering mode', 'UINT16', 'GetSet'),
    // PTP 1.1 (ISO 15740) FlashMode 0x0001-0x0006, in Slate's canonical flash vocabulary. Vendor
    // extensions (0x8000 and above) stay unrecognized: read-only, never a writable choice.
    FlashMode: {
        code: 0x500c,
        name: 'FlashMode',
        description: 'Flash mode',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry =>
            createEnumCodec(
                registry,
                [
                    { value: 0x0001, name: 'Auto', description: 'Auto flash' },
                    { value: 0x0002, name: 'Off', description: 'Flash off' },
                    { value: 0x0003, name: 'Fill', description: 'Fill flash' },
                    { value: 0x0004, name: 'Red-eye auto', description: 'Red-eye reduction, auto' },
                    { value: 0x0005, name: 'Red-eye fill', description: 'Red-eye reduction, fill' },
                    { value: 0x0006, name: 'External sync', description: 'External sync' },
                ] as const,
                registry.codecs.uint16
            ),
    },
    ExposureTime: {
        code: 0x500d,
        name: 'ExposureTime',
        description: 'Exposure time (shutter speed)',
        datatype: UINT32,
        access: 'GetSet',
        codec: registry =>
            new (class extends CustomCodec<string> {
                encode(value: string): Uint8Array {
                    // Parse strings like "1/250", "1.3\"", "BULB"
                    const uint32 = this.baseCodecs.uint32

                    if (value === 'BULB') return uint32.encode(0xffffffff)

                    const text = value.trim()
                    const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(text)
                    const seconds = fraction
                        ? Number(fraction[1]) / Number(fraction[2])
                        : /^\d+(?:\.\d+)?"?$/.test(text)
                          ? Number(text.replace('"', ''))
                          : NaN
                    const ticks = Math.round(seconds * 10000)
                    if (!Number.isFinite(seconds) || seconds <= 0 || ticks < 1 || ticks >= 0xffffffff)
                        throw new Error(`Invalid or unrepresentable exposure time: ${value}`)
                    return uint32.encode(ticks)
                }
                decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
                    const uint32 = this.baseCodecs.uint32
                    const result = uint32.decode(buffer, offset)
                    const rawValue = result.value

                    // Handle BULB mode
                    if (rawValue === 0xffffffff) return { value: 'BULB', bytesRead: result.bytesRead }

                    // Convert to seconds
                    const seconds = rawValue / 10000

                    if (rawValue === 0) throw new Error('Exposure time cannot be zero')
                    const denominator = Math.round(1 / seconds)
                    // Keep familiar fractions only when encoding them preserves the camera's exact ticks.
                    const value =
                        seconds < 1 && Math.round(10000 / denominator) === rawValue ? `1/${denominator}` : `${seconds}"`
                    return { value, bytesRead: result.bytesRead }
                }
            })(registry),
    },
    ExposureProgramMode: {
        code: 0x500e,
        name: 'ExposureProgramMode',
        description: 'Exposure program mode',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry =>
            new (class extends CustomCodec<string> {
                encode(value: string): Uint8Array {
                    const entry = Object.entries(EXPOSURE_PROGRAM_NAMES).find(
                        ([, name]) => name.toLowerCase() === value.toLowerCase()
                    )
                    const raw = entry
                        ? Number(entry[0])
                        : Number.parseInt(value.replace(/^.*0x/i, ''), value.toLowerCase().includes('0x') ? 16 : 10)
                    if (!Number.isFinite(raw)) throw new Error(`Unknown exposure program mode: ${value}`)
                    return this.baseCodecs.uint16.encode(raw)
                }
                decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
                    const result = this.baseCodecs.uint16.decode(buffer, offset)
                    return {
                        value: EXPOSURE_PROGRAM_NAMES[result.value] ?? `Mode 0x${result.value.toString(16)}`,
                        bytesRead: result.bytesRead,
                    }
                }
            })(registry),
    },
    ExposureIndex: {
        code: 0x500f,
        name: 'ExposureIndex',
        description: 'ISO speed',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry =>
            new (class extends CustomCodec<string> {
                encode(value: string): Uint8Array {
                    const uint16 = this.baseCodecs.uint16
                    // Parse strings like "ISO 100", "ISO AUTO", "100", "auto"
                    if (value.toLowerCase().includes('auto')) return uint16.encode(0xffff)
                    const numericValue = parseInt(value.replace(/\D/g, ''))
                    return uint16.encode(numericValue)
                }
                decode(buffer: Uint8Array, offset = 0): { value: string; bytesRead: number } {
                    const uint16 = this.baseCodecs.uint16
                    const result = uint16.decode(buffer, offset)
                    if (result.value === 0xffff) return { value: 'ISO AUTO', bytesRead: result.bytesRead }
                    return { value: `ISO ${result.value}`, bytesRead: result.bytesRead }
                }
            })(registry),
    },
    ExposureBiasCompensation: scalar(
        0x5010,
        'ExposureBiasCompensation',
        'Exposure bias compensation',
        'INT16',
        'GetSet'
    ),
    DateTime: scalar(0x5011, 'DateTime', 'Device date and time', 'STR', 'GetSet'),
    CaptureDelay: scalar(0x5012, 'CaptureDelay', 'Capture delay in milliseconds', 'UINT32', 'GetSet'),
    /** ISO 15740 StillCaptureMode values, named in Slate's canonical drive-mode spelling. */
    StillCaptureMode: {
        code: 0x5013,
        name: 'StillCaptureMode',
        description: 'Still capture mode',
        datatype: UINT16,
        access: 'GetSet',
        codec: registry =>
            createEnumCodec(
                registry,
                [
                    { value: 0x0001, name: 'Single', description: 'Normal single-frame capture' },
                    { value: 0x0002, name: 'Continuous', description: 'Burst' },
                    { value: 0x0003, name: 'Timelapse', description: 'Timelapse' },
                ] as const,
                registry.codecs.uint16
            ),
    },
    Contrast: scalar(0x5014, 'Contrast', 'Contrast setting', 'UINT8', 'GetSet'),
    Sharpness: scalar(0x5015, 'Sharpness', 'Sharpness setting', 'UINT8', 'GetSet'),
    DigitalZoom: scalar(0x5016, 'DigitalZoom', 'Digital zoom factor', 'UINT8', 'GetSet'),
    EffectMode: scalar(0x5017, 'EffectMode', 'Effect mode', 'UINT16', 'GetSet'),
    BurstNumber: scalar(0x5018, 'BurstNumber', 'Number of burst shots', 'UINT16', 'GetSet'),
    BurstInterval: scalar(0x5019, 'BurstInterval', 'Burst interval in milliseconds', 'UINT16', 'GetSet'),
    TimelapseNumber: scalar(0x501a, 'TimelapseNumber', 'Number of timelapse shots', 'UINT16', 'GetSet'),
    TimelapseInterval: scalar(0x501b, 'TimelapseInterval', 'Timelapse interval in milliseconds', 'UINT32', 'GetSet'),
    FocusMeteringMode: scalar(0x501c, 'FocusMeteringMode', 'Focus metering mode', 'UINT16', 'GetSet'),
    UploadURL: scalar(0x501d, 'UploadURL', 'Upload URL', 'STR', 'GetSet'),
    Artist: scalar(0x501e, 'Artist', 'Artist name', 'STR', 'GetSet'),
    CopyrightInfo: scalar(0x501f, 'CopyrightInfo', 'Copyright information', 'STR', 'GetSet'),
    SupportedStreams: scalar(0x5020, 'SupportedStreams', 'Supported streams bitmask (PTP v1.1)', 'UINT32', 'Get'),
    EnabledStreams: scalar(0x5021, 'EnabledStreams', 'Enabled streams bitmask (PTP v1.1)', 'UINT32', 'GetSet'),
    VideoFormat: scalar(0x5022, 'VideoFormat', 'Video format (FOURCC code) (PTP v1.1)', 'UINT32', 'GetSet'),
    VideoResolution: scalar(
        0x5023,
        'VideoResolution',
        'Video resolution (e.g., "320x240") (PTP v1.1)',
        'STR',
        'GetSet'
    ),
    VideoQuality: scalar(0x5024, 'VideoQuality', 'Video quality level (PTP v1.1)', 'UINT16', 'GetSet'),
    VideoFrameRate: scalar(
        0x5025,
        'VideoFrameRate',
        'Video frame interval in microseconds (PTP v1.1)',
        'UINT32',
        'GetSet'
    ),
    VideoContrast: scalar(0x5026, 'VideoContrast', 'Video contrast level (PTP v1.1)', 'UINT16', 'GetSet'),
    VideoBrightness: scalar(0x5027, 'VideoBrightness', 'Video brightness level (PTP v1.1)', 'UINT16', 'GetSet'),
    AudioFormat: scalar(
        0x5028,
        'AudioFormat',
        'Audio format code from RIFF specification (PTP v1.1)',
        'UINT32',
        'GetSet'
    ),
    AudioBitrate: scalar(0x5029, 'AudioBitrate', 'Audio bitrate in bits per second (PTP v1.1)', 'UINT32', 'GetSet'),
    AudioSamplingRate: scalar(
        0x502a,
        'AudioSamplingRate',
        'Audio sampling rate in hertz (PTP v1.1)',
        'UINT32',
        'GetSet'
    ),
    AudioBitPerSample: scalar(0x502b, 'AudioBitPerSample', 'Audio bits per sample (PTP v1.1)', 'UINT16', 'GetSet'),
    AudioVolume: scalar(0x502c, 'AudioVolume', 'Audio volume level (PTP v1.1)', 'UINT32', 'GetSet'),
} as const satisfies { [key: string]: PropertyDefinition }

export const {
    FocalLength,
    DateTime,
    ExposureBiasCompensation,
    ExposureIndex,
    ExposureMeteringMode,
    ExposureProgramMode,
    ExposureTime,
    FNumber,
    FlashMode,
    FocusMode,
    ImageSize,
    StillCaptureMode,
    WhiteBalance,
} = genericPropertyRegistry

export type GenericPropertyDef = (typeof genericPropertyRegistry)[keyof typeof genericPropertyRegistry]
