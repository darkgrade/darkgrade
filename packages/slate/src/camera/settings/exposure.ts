import type { CameraControlState } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import type { ExposureContext, ExposureTime } from '@camera/exposure-time'
import type { SettingReaders, SettingTypes } from '@camera/settings/setting-types'
import { formatShutterSpeed, type ShutterSpeed } from '@camera/settings/shutter-speed'

/** Exposure settings: canonical ids, labels and search aliases. */
export const exposureControlDefinitions = {
    shutterSpeed: {
        label: 'Shutter speed',
        aliases: ['shutter speed', 'shutter angle', 'shutterAngle', 'exposureTime', 'exposure time'],
    },
    iso: { label: 'ISO', aliases: ['sensitivity', 'exposure index', 'gain', 'EI'] },
    aperture: { label: 'Aperture', aliases: ['f number', 'f-stop', 'iris', 'T-stop'] },
    exposureMode: {
        label: 'Exposure mode',
        // 'exposure program' joins these once the transitional exposureProgram id below is gone.
        aliases: ['exposure mode', 'PASM', 'mode dial', 'exposureProgramMode'],
    },
    exposureCompensation: {
        label: 'Exposure compensation',
        aliases: ['exposure compensation', 'EV', 'exposure comp', 'exposure bias'],
    },
    meteringMode: { label: 'Metering', aliases: ['metering mode', 'metering'] },
    /**
     * Transitional: the camera's own shooting-mode word (Sony `Movie Manual`, a Canon AE code),
     * read and written verbatim. Recording preparation and Studio's photo/movie toggle still use it
     * until photoVideoMode lands; exposure mode itself is `exposureMode`. No typed accessor.
     */
    exposureProgram: { label: 'Shooting mode', aliases: ['shooting mode'] },
} as const

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
export const exposureModes = [
    'Manual',
    'Aperture priority',
    'Shutter priority',
    'Program',
    'Auto',
    'Flexible priority',
    'Bulb',
] as const
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
export const meteringModes = [
    'Multi',
    'Center-weighted',
    'Spot',
    'Large spot',
    'Partial',
    'Average',
    'Highlight',
] as const
export type MeteringMode = (typeof meteringModes)[number]

/**
 * Value types of this group's typed settings. Each id listed here gets `get<Id>()` and
 * `set<Id>(value)` on Camera and on every CameraControlSession (see `@camera/settings/typed-settings`).
 * Values are canonical names; each vendor's words are mapped in `@vendors/control-properties/exposure`.
 */
export interface ExposureSettingTypes {
    shutterSpeed: SettingTypes<ShutterSpeed, ShutterSpeed | ExposureTime, [context?: ExposureContext]>
    aperture: SettingTypes<Aperture>
    iso: SettingTypes<Iso>
    exposureMode: SettingTypes<ExposureMode, ExposureMode | ExposureModeAlias>
    exposureCompensation: SettingTypes<ExposureCompensation>
    meteringMode: SettingTypes<MeteringMode>
}

const number = String.raw`\d+(?:\.\d+)?`
const isAperture = (value: string): value is Aperture => value === 'Auto' || new RegExp(`^f/${number}$`).test(value)
const isIso = (value: string): value is Iso =>
    value === 'Auto' || new RegExp(`^(?:ISO|Multi Frame NR ISO|Multi Frame NR High ISO) \\d+$`).test(value) ||
    /^ISO \d+ \(extended\)$/.test(value)
const isExposureMode = (value: string): value is ExposureMode => exposureModes.some(mode => mode === value)
const isExposureCompensation = (value: string): value is ExposureCompensation =>
    value === '0.0' || new RegExp(`^[+-]${number}$`).test(value)
const isMeteringMode = (value: string): value is MeteringMode => meteringModes.some(mode => mode === value)

function canonicalReader<Value extends string>(
    id: string,
    label: string,
    accepts: (value: string) => value is Value
): (state: CameraControlState) => Value {
    return state => {
        if (accepts(state.value)) return state.value
        throw new CameraUnsupportedError(id, `${label}: the camera reports a value Slate cannot read (${state.value})`)
    }
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const exposureSettingReaders: SettingReaders<ExposureSettingTypes> = {
    shutterSpeed: state => formatShutterSpeed(state.exposureTime, state.value),
    aperture: canonicalReader('aperture', 'Aperture', isAperture),
    iso: canonicalReader('iso', 'ISO', isIso),
    exposureMode: canonicalReader('exposureMode', 'Exposure mode', isExposureMode),
    exposureCompensation: canonicalReader('exposureCompensation', 'Exposure compensation', isExposureCompensation),
    meteringMode: canonicalReader('meteringMode', 'Metering', isMeteringMode),
}

/** `f/` and the f-number with at most one decimal and no trailing zero. */
export function formatAperture(fNumber: number): Aperture {
    return `f/${Number(fNumber.toFixed(1))}`
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
        return fNumber ? formatAperture(Number(fNumber[1])) : text
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
