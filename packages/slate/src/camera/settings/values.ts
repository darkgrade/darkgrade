import { CameraUnsupportedError } from '@camera/errors'
import type { ExposureTime } from '@camera/exposure-time'
import type { CodecType } from '@ptp/types/codec'
import type { CanonImageFormat, CanonImageFormatLabel } from '@vendors/canon/datasets/canon-image-format-dataset'
import type { CanonMovieFormat } from '@vendors/canon/datasets/canon-movie-format-dataset'
import type { CanonicalValueNames, CodecValue, NamedControlValue } from '@vendors/control-properties'
import type * as sony from '@vendors/sony/definitions/sony-property-definitions'

/**
 * The canonical value types of the typed settings, their spellings and conversions. Values are
 * canonical names; each vendor's words are mapped in `@vendors/<vendor>/control-properties`. Vendor
 * imports are type-only, so `@darkgrade/slate/controls` stays free of vendor codecs.
 */

/**
 * A shutter speed in Slate's one spelling, whatever the vendor calls it: `'1/250'`, `'30"'`,
 * `'0.3"'`, `'180°'`, `'Bulb'`. Each vendor codec's label (Sony `BULB`, Canon `30`, a standard
 * ExposureTime tick count) is read through `parseExposureTime` and written back in this form.
 */
export type ShutterSpeed = `${number}/${number}` | `${number}"` | `${number}°` | 'Bulb' | 'Time' | 'Flash sync' | 'Auto'

const relativeTolerance = 1e-9

function close(left: number, right: number): boolean {
    return Math.abs(left - right) <= relativeTolerance * Math.max(Math.abs(left), Math.abs(right))
}

function formatDuration(seconds: number, observedLabel?: string): ShutterSpeed {
    const reciprocal = Math.round(1 / seconds)
    if (seconds < 1 && reciprocal >= 1 && close(1 / reciprocal, seconds)) return `1/${reciprocal}`
    const tenths = Math.round(seconds * 10) / 10
    if (close(tenths, seconds)) return `${tenths}"`
    // A fraction that is neither 1/n nor whole tenths keeps the camera's own ratio, if it gave one.
    const ratio = observedLabel && /^(\d+)\/(\d+)$/.exec(observedLabel.trim())
    if (ratio && close(Number(ratio[1]) / Number(ratio[2]), seconds)) return `${Number(ratio[1])}/${Number(ratio[2])}`
    return `${seconds}"`
}

/** The canonical spelling of an observed exposure; the camera's label is used only to keep a ratio. */
export function formatShutterSpeed(exposure: ExposureTime | undefined, observedLabel?: string): ShutterSpeed {
    // Only the parsed observation counts: a label Slate could not read is never given units here.
    const label = observedLabel ? ` (${observedLabel})` : ''
    if (!exposure) throw new CameraUnsupportedError('shutterSpeed', `Shutter speed: the camera reports a value Slate cannot read${label}`)
    switch (exposure.kind) {
        case 'duration':
            return formatDuration(exposure.seconds, observedLabel)
        case 'angle':
            return `${exposure.degrees}°`
        case 'bulb':
            return 'Bulb'
        case 'time':
            return 'Time'
        case 'flash-sync':
            return 'Flash sync'
        case 'auto':
            return 'Auto'
    }
}

/** An aperture in Slate's one spelling: `f/` and the f-number without trailing zeros (`f/4`, `f/2.8`). */
export type Aperture = `f/${number}` | 'Auto'

/**
 * An ISO sensitivity: `ISO 800`, `Auto`, and the Sony labels that are distinct settings rather than
 * spellings (an extended sensitivity, the Multi Frame NR sensitivities). Auto/manual on a Sony body
 * with a separate gain switch is the recorded exception: Slate flips that switch inside the write.
 */
export type Iso =
    | `ISO ${number}`
    | `ISO ${number} (extended)`
    | `Multi Frame NR ISO ${number}`
    | `Multi Frame NR High ISO ${number}`
    | 'Auto'

/** The exposure modes, as words. Each vendor's own spelling (Sony `Movie Manual`, Canon `Tv`) maps here. */
export const exposureModes = ['Manual', 'Aperture priority', 'Shutter priority', 'Program', 'Auto', 'Flexible priority', 'Bulb'] as const
export type ExposureMode = (typeof exposureModes)[number]

/** Short forms accepted as input: the mode-dial letters and Canon's Av/Tv/Fv. */
export const exposureModeAliases = {
    M: 'Manual',
    A: 'Aperture priority',
    Av: 'Aperture priority',
    S: 'Shutter priority',
    Tv: 'Shutter priority',
    P: 'Program',
    Fv: 'Flexible priority',
    B: 'Bulb',
} as const satisfies Record<string, ExposureMode>
export type ExposureModeAlias = keyof typeof exposureModeAliases

/** Exposure compensation in stops with one decimal and a sign: `+0.7`, `-1.0`, `0.0`. */
export type ExposureCompensation = `+${number}` | `-${number}` | '0.0'

/** The metering modes, as words. Canon Evaluative and Nikon Matrix are `Multi`. */
export const meteringModes = ['Multi', 'Center-weighted', 'Spot', 'Large spot', 'Partial', 'Average', 'Highlight'] as const
export type MeteringMode = (typeof meteringModes)[number]

const number = String.raw`\d+(?:\.\d+)?`
export const isAperture = (value: string): value is Aperture => value === 'Auto' || new RegExp(`^f/${number}$`).test(value)
export const isIso = (value: string): value is Iso =>
    value === 'Auto' || new RegExp(`^(?:ISO|Multi Frame NR ISO|Multi Frame NR High ISO) \\d+$`).test(value) ||
    /^ISO \d+ \(extended\)$/.test(value)
export const isExposureCompensation = (value: string): value is ExposureCompensation =>
    value === '0.0' || new RegExp(`^[+-]${number}$`).test(value)

/**
 * `f/` and the f-number without trailing zeros (`f/4`, `f/2.8`, `f/0.95`). Two decimals, the
 * resolution of the PTP FNumber unit (hundredths), so a camera's f/0.95 is never named f/0.9.
 */
export function formatAperture(fNumber: number): Aperture {
    return `f/${Number(fNumber.toFixed(2))}`
}

/** Stops with a sign and one decimal; thirds read as .3 and .7, halves as .5. */
export function formatExposureCompensation(stops: number): ExposureCompensation {
    const rounded = Math.round(stops * 10) / 10
    const text = rounded === 0 ? '0.0' : `${rounded > 0 ? '+' : '-'}${Math.abs(rounded).toFixed(1)}`
    if (!isExposureCompensation(text)) throw new RangeError(`Exposure compensation is not a number of stops: ${stops}`)
    return text
}

const caseInsensitive = (left: string, right: string) => left.toLowerCase() === right.toLowerCase()

/**
 * Exact alternative spellings of an exposure value that `setControl` accepts besides the canonical
 * one: `M`, `Av`, `manual`; `800` for `ISO 800`; `f4`, `F4.0` for `f/4`; `+1` for `+1.0`. Never a
 * nearby value: the result must still be one the camera advertises.
 */
export function canonicalExposureInput(id: string, value: string): string {
    const text = value.trim()
    if (id === 'exposureMode') {
        const alias = Object.entries(exposureModeAliases).find(([short]) => short === text)?.[1]
        return alias ?? exposureModes.find(mode => caseInsensitive(mode, text)) ?? text
    }
    if (id === 'meteringMode') return meteringModes.find(mode => caseInsensitive(mode, text)) ?? text
    if (id === 'iso') {
        if (/^(?:iso\s*)?auto$/i.test(text)) return 'Auto'
        const sensitivity = /^(?:iso\s*)?(\d+)$/i.exec(text)
        return sensitivity ? `ISO ${Number(sensitivity[1])}` : text
    }
    if (id === 'aperture') {
        if (/^auto$/i.test(text)) return 'Auto'
        const fNumber = new RegExp(`^(?:f\\s*/?\\s*)?(${number})$`, 'i').exec(text)
        if (!fNumber) return text
        // Only trailing zeros are dropped (F4.0 is f/4); f/2.83 stays f/2.83 and is refused, never written as f/2.8.
        const exact = formatAperture(Number(fNumber[1]))
        return exact === `f/${Number(fNumber[1])}` ? exact : text
    }
    if (id === 'exposureCompensation') {
        const stops = new RegExp(`^([+-]?${number})(?:\\s*EV)?$`, 'i').exec(text)
        if (!stops) return text
        const parsed = Number(stops[1])
        // Only exact one-decimal spellings; +0.33 is not silently rounded to +0.3.
        return Math.round(parsed * 10) / 10 === parsed ? formatExposureCompensation(parsed) : text
    }
    return text
}

/**
 * Whether the camera is set up to take photos or record video. One view of each vendor's own
 * switch (see `@vendors/photo-video-mode`): Canon's movie select switch, Nikon's LiveViewSelector,
 * and on Sony the photo and movie halves of the exposure program (Manual and Movie Manual).
 */
export type PhotoVideoMode = 'photo' | 'video'

/** A drive mode in Slate's one spelling (`'Single'`, `'Continuous high'`, `'Self-timer 10 s'`, ...). */
export type DriveMode = CodecValue<'driveMode'>

/**
 * A white balance in Slate's one spelling, whatever the vendor calls it: Nikon's "Sunny" is
 * `'Daylight'`, Canon's kebab-case codes are `'Auto'`, `'Shade'`, `'Color Temperature'` and so on.
 * The names come from the vendor codecs (`@ptp/definitions`), one table per vendor and mode.
 */
export type WhiteBalance = CodecValue<'whiteBalance'>

/** A colour temperature in kelvin. */
export type ColorTemperature = number

/**
 * A requested colour temperature as kelvin: a finite number, or the whole-number spelling the
 * capabilities list it in (`'2500'`), so every advertised choice can be written back. Otherwise undefined.
 */
export function kelvinInput(value: unknown): number | undefined {
    const kelvin = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : NaN
    return Number.isFinite(kelvin) ? kelvin : undefined
}

/**
 * A look in Slate's one spelling: Canon Picture Style, Nikon Picture Control and Sony Creative
 * Look or Creative Style (`'Standard'`, `'Portrait'`, `'Monochrome'`, ...).
 */
export type PictureStyle = CodecValue<'pictureStyle'>

/** A Sony Picture Profile (`'Off'`, `'PP1'` to `'PP11'`, `'PP LUT 1'` to `'PP LUT 4'`). */
export type PictureProfile = CodecValue<'pictureProfile'>

/** AF-S, AF-C or MF, and the other modes a body offers (AF-A, DMF, AF-F, ...). Canon One-Shot is AF-S. */
export type FocusMode = NamedControlValue<'focusMode'>
/** Wide, Zone, Spot M, Tracking Spot M, ...; Sony's Flexible Spot is Spot, Lock-on AF is Tracking. */
export type FocusArea = NamedControlValue<'focusArea'>
/** Whether the camera looks for faces, eyes and other subjects to focus on. */
export type SubjectDetection = NamedControlValue<'subjectDetection'>
/** What subject detection looks for: People, Animals, Birds, ... */
export type DetectionSubject = NamedControlValue<'detectionSubject'>
/** Which eye subject detection focuses on: Auto, Right or Left. */
export type EyeSelection = NamedControlValue<'eyeSelection'>

/**
 * A photo format, in each vendor codec's own spelling: `'RAW'`, `'RAW+JPEG'`, `'JPEG'` on current
 * Sony bodies; format and quality together (`'RAW+JPEG Fine'`, `'HEIF Standard'`) on Sony bodies
 * with one combined setting; Canon's format with its size (`'RAW'`, `'cRAW+L'`, `'M'`).
 */
export type PhotoFormat = Exclude<CodecValue<'photoFormat'>, CanonImageFormat> | CanonImageFormatLabel

/**
 * A photo size: Sony's codec names (`'Large'`, `'Medium'`, `'Small'`), or the pixel dimensions a
 * standard body lists. The standard ImageSize property is a free-form string, which collapses the
 * codec union to `string`; Sony's enumerated size names come from its own codec instead.
 */
export type PhotoSize =
    | Exclude<CodecValue<'photoSize'>, string>
    | CodecType<(typeof sony.SonyImageSize)['codec']>
    | `${number}x${number}`

export type AspectRatio = CodecValue<'aspectRatio'>
export type JpegQuality = CodecValue<'jpegQuality'>
export type RawCompression = CodecValue<'rawCompression'>
export type FlashMode = CodecValue<'flashMode'>

/**
 * Canon's movie record names resolution, frame rate, container and compression in one value,
 * spelled by its codec as `4K 23.98 fps · MP4 · IPB (Standard)`.
 */
export type CanonMovieRecord = `${string} fps · ${CanonMovieFormat['container']} · ${CanonMovieFormat['compression']}`

/** A video format: Sony's codec names (`XAVC S 4K`) or Canon's complete movie record. */
export type VideoFormat = Exclude<CodecValue<'videoFormat'>, CanonMovieFormat> | CanonMovieRecord
/** A video quality (bit rate, sampling and depth), as the vendor codecs name it: `150M 4:2:0 10-bit`. */
export type VideoQuality = CodecValue<'videoQuality'>
/** A frame rate: `24p`, `23.98p`, `60p`, `50i`. */
export type FrameRate = CodecValue<'frameRate'>
/** Movie sound, Canon only for now: `On`, `Off` or `On (manual level)`. */
export type AudioRecording = Exclude<CodecValue<'audioRecording'>, 'camera-specific-0'>

/** Canonical names for Sony's digital zoom codec values; type-only imports keep it browser-safe. */
export const videoValueNames = {
    ZoomSetting: { 'Optical Zoom Only': 'Off', 'Clear Image Zoom': 'Clear Image Zoom', 'Digital Zoom': 'Digital Zoom' },
} as const satisfies { ZoomSetting: CanonicalValueNames<typeof sony.ZoomSetting> }

/** How far zoom reaches past the optics: Off is optical only. From the codecs. */
export type DigitalZoom = (typeof videoValueNames.ZoomSetting)[keyof typeof videoValueNames.ZoomSetting]

/** Every digital zoom name, for its reader. */
export const digitalZoomValues: readonly DigitalZoom[] = Object.values(videoValueNames.ZoomSetting)

/** Canonical names for Sony's live-view quality codec values; type-only imports keep it browser-safe. */
export const liveViewValueNames = {
    LiveViewImageQuality: { LOW: 'Low', HIGH: 'High' },
} as const satisfies { LiveViewImageQuality: CanonicalValueNames<typeof sony.LiveViewImageQuality> }

/** The live-view picture's quality: High is sharper, Low lighter on the connection. From the codecs. */
export type LiveViewQuality =
    (typeof liveViewValueNames.LiveViewImageQuality)[keyof typeof liveViewValueNames.LiveViewImageQuality]

export const liveViewQualityValues: readonly LiveViewQuality[] = Object.values(liveViewValueNames.LiveViewImageQuality)
