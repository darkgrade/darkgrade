import { formatExposureCompensation, type ExposureMode, type MeteringMode } from '@camera/settings/values'
import type { CodecType } from '@ptp/types/codec'
import * as canon from '@vendors/canon/definitions/canon-property-definitions'
import type { ControlPropertyMap, ControlValueNameTable, ControlValueTable } from '@vendors/control-properties'
import { fNumberLabel, isoLabel, lookup } from '@vendors/generic/control-properties'

/**
 * Canon's properties: for each canonical id, the properties that carry it in preference order.
 * Typed definitions, so each setting's value type is derived from the codecs (see `CodecValue`).
 *
 * photoVideoMode is the movie select switch operations read back through FixedMovie, composed in
 * `@vendors/photo-video-mode`. Canon lists Movie Servo AF before its focus mode: in video mode
 * Movie Servo AF is what makes focus continuous, so it is the focus mode there
 * (`canonFocusModeStates` keeps it only then). Canon carries resolution, frame rate, container and
 * compression in one movie record, offered as the video format.
 */
export const canonControlProperties = {
    shutterSpeed: [canon.CanonShutterSpeed],
    iso: [canon.CanonIso],
    aperture: [canon.CanonAperture],
    exposureMode: [canon.CanonAutoExposureMode],
    exposureCompensation: [canon.CanonExpCompensation],
    meteringMode: [canon.CanonMeteringMode],
    driveMode: [canon.CanonDriveMode],
    whiteBalance: [canon.CanonWhiteBalance],
    colorTemperature: [canon.CanonColorTemperature],
    pictureStyle: [canon.CanonPictureStyle],
    focusMode: [canon.CanonMovieServoAutofocus, canon.CanonFocusMode],
    focusArea: [canon.CanonLiveViewAutofocusMode],
    continuousAutofocus: [canon.CanonContinuousAutofocus],
    photoFormat: [canon.CanonImageFormat, canon.CanonImageFormatSd],
    videoFormat: [canon.CanonMovieFormat],
    audioRecording: [canon.CanonMovieSoundRecording],
} as const satisfies ControlPropertyMap

/**
 * Canon exposure compensation, a signed byte in eighths of a stop where 3 and 5 are a third and two
 * thirds (libgphoto2 `canon_eos_exposurecomp`, EDSDK kEdsPropID_ExposureCompensation).
 */
const canonEighthsOfAStop = (label: string) => {
    if (!/^\d+$/.test(label.trim())) return undefined
    const byte = Number(label) & 0xff
    const eighths = byte >= 0x80 ? byte - 0x100 : byte
    const whole = Math.trunc(eighths / 8)
    const remainder = Math.abs(eighths - whole * 8)
    const fraction = ({ 0: 0, 3: 1 / 3, 4: 1 / 2, 5: 2 / 3 } as Record<number, number>)[remainder]
    if (fraction === undefined) return undefined
    return formatExposureCompensation(whole + Math.sign(eighths) * fraction)
}

/** Canon AE modes (libgphoto2 `canon_eos_autoexposuremode`, EDSDK kEdsAEMode). */
const canonExposureMode = lookup<ExposureMode>({
    '0': 'Program',
    '1': 'Shutter priority',
    '2': 'Aperture priority',
    '3': 'Manual',
    '4': 'Bulb',
    '9': 'Auto',
    '22': 'Auto',
    '55': 'Flexible priority',
})

/** Canon metering (EDSDK kEdsPropID_MeteringMode): 1 Spot, 3 Evaluative, 4 Partial, 5 Center-weighted. */
const canonMetering = lookup<MeteringMode>({ '1': 'Spot', '3': 'Multi', '4': 'Partial', '5': 'Center-weighted' })

/**
 * Canon's words for the exposure settings, mapped to the canonical names of `@camera/settings/values`.
 * A word with no canonical name is left out of the choices and never written.
 */
export const canonControlValues = {
    // 0x0000 (implicit auto in Tv/P), 0xffff and 0x00b0 are all `auto` in the Canon codec: read, never written.
    aperture: { canonical: fNumberLabel, readOnly: ['Auto'] },
    iso: { canonical: label => (/^auto(?:_iso)?$/.test(label) ? 'Auto' : isoLabel(`ISO ${label}`)) },
    exposureMode: { canonical: canonExposureMode },
    exposureCompensation: { canonical: canonEighthsOfAStop },
    meteringMode: { canonical: canonMetering },
} as const satisfies ControlValueTable

type Names<Value extends string> = Readonly<Record<Value, string>>

/** EOS One-Shot, AI Servo and AI Focus are AF-S, AF-C and AF-A; the lens switch at MF reads manual. */
const canonFocusModes = {
    'one-shot': 'AF-S',
    'ai-servo': 'AF-C',
    'ai-focus': 'AF-A',
    manual: 'MF',
} as const satisfies Names<CodecType<typeof canon.CanonFocusMode.codec>>

/** In video mode, Movie Servo AF on is continuous focus and off focuses once per AF press. */
const canonMovieServo = { on: 'AF-C', off: 'AF-S' } as const satisfies Names<
    CodecType<typeof canon.CanonMovieServoAutofocus.codec>
>

const canonFocusAreas = {
    quick: 'Quick',
    live: 'Single Point',
    face: 'Face Tracking',
    multi: 'Multi Point',
    zone: 'Zone',
    'expand-cross': 'Expanded Point Cross',
    'expand-around': 'Expanded Point Around',
    'large-zone-horizontal': 'Large Zone Horizontal',
    'large-zone-vertical': 'Large Zone Vertical',
    tracking: 'Tracking',
    spot: 'Spot',
    'flexible-zone-1': 'Flexible Zone 1',
    'flexible-zone-2': 'Flexible Zone 2',
    'flexible-zone-3': 'Flexible Zone 3',
    'whole-area': 'Wide',
    'spot-without-tracking': 'Spot Without Tracking',
    'one-point-without-tracking': 'Single Point Without Tracking',
    'expand-cross-without-tracking': 'Expanded Point Cross Without Tracking',
    'expand-around-without-tracking': 'Expanded Point Around Without Tracking',
} as const satisfies Names<CodecType<typeof canon.CanonLiveViewAutofocusMode.codec>>

const canonContinuous = { on: 'On', off: 'Off' } as const satisfies Names<
    CodecType<typeof canon.CanonContinuousAutofocus.codec>
>

/** The canonical name of each Canon value, per setting and property (see `sonyControlValueNames`). */
export const canonControlValueNames = {
    focusMode: { CanonFocusMode: canonFocusModes, CanonMovieServoAutofocus: canonMovieServo },
    focusArea: { CanonLiveViewAutofocusMode: canonFocusAreas },
    continuousAutofocus: { CanonContinuousAutofocus: canonContinuous },
} as const satisfies ControlValueNameTable

/**
 * Canon: Movie Servo AF stands for the focus mode only in video mode and with the lens at AF.
 * In photo mode (or at MF) the EOS focus mode itself is the observation.
 */
export function canonFocusModeStates<State extends { name: string; value: unknown }>(
    states: State[],
    videoMode: boolean
): State[] {
    const lensAtManual = states.some(state => state.name === 'CanonFocusMode' && state.value === 'manual')
    if (videoMode && !lensAtManual) return states
    return states.filter(state => state.name !== 'CanonMovieServoAutofocus')
}
