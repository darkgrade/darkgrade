import {
    formatAperture,
    formatExposureCompensation,
    type exposureControlDefinitions,
    type ExposureMode,
    type MeteringMode,
} from '@camera/settings/exposure'
import * as standard from '@ptp/definitions/property-definitions'
import * as canon from '@vendors/canon/definitions/canon-property-definitions'
import * as nikon from '@vendors/nikon/definitions/nikon-shooting-property-definitions'
import * as sony from '@vendors/sony/definitions/sony-property-definitions'
import type {
    ControlValueVocabulary,
    VendorControlProperties,
    VendorControlValues,
} from '@vendors/control-properties/vendor-control-properties'

type ExposureId = keyof typeof exposureControlDefinitions

const standardProperties = {
    shutterSpeed: [standard.ExposureTime],
    iso: [standard.ExposureIndex],
    aperture: [standard.FNumber],
    exposureMode: [standard.ExposureProgramMode],
    exposureCompensation: [standard.ExposureBiasCompensation],
    meteringMode: [standard.ExposureMeteringMode],
} as const

/**
 * The exposure group's vendor properties: for each canonical id, the properties that carry it,
 * in preference order within one vendor and mode (never across vendors). Typed definitions, so
 * each setting's value type is derived from the codecs (see `CodecValue`).
 */
export const exposureControlProperties = {
    sony: {
        shutterSpeed: [sony.ShutterSpeed],
        iso: [sony.Iso],
        aperture: [sony.Aperture, standard.FNumber],
        exposureMode: [standard.ExposureProgramMode],
        exposureCompensation: [sony.ExposureBiasCompensation, sony.ExposureCompensation],
        meteringMode: [sony.ExposureMeteringMode],
    },
    canon: {
        shutterSpeed: [canon.CanonShutterSpeed],
        iso: [canon.CanonIso],
        aperture: [canon.CanonAperture],
        exposureMode: [canon.CanonAutoExposureMode],
        exposureCompensation: [canon.CanonExpCompensation],
        meteringMode: [canon.CanonMeteringMode],
    },
    standard: standardProperties,
    nikonPhoto: {
        ...standardProperties,
        shutterSpeed: [nikon.NikonPhotoShutterSpeed, standard.ExposureTime],
    },
    nikonMovie: {
        ...standardProperties,
        shutterSpeed: [nikon.NikonMovieShutterSpeed, standard.ExposureTime],
        iso: [nikon.NikonMovieISO],
        aperture: [nikon.NikonMovieFNumber],
    },
} as const satisfies VendorControlProperties<ExposureId>

/** An f-number label (`f/2.8`, `F4.0`), or the `auto` Canon's codec names its automatic codes. */
const fNumber = (label: string) => {
    const text = label.trim()
    if (/^auto$/i.test(text)) return 'Auto'
    const match = /^f\/?(\d+(?:\.\d+)?)$/i.exec(text)
    return match ? formatAperture(Number(match[1])) : undefined
}

/** `ISO 800`, `ISO AUTO`, and Sony's distinct extended / Multi Frame NR sensitivities. */
const isoLabel = (label: string) => {
    const text = label.trim()
    if (/^(?:iso\s*)?auto$/i.test(text)) return 'Auto'
    const match = /^(ISO|Multi Frame NR ISO|Multi Frame NR High ISO) (\d+)( \(extended\))?$/.exec(text)
    if (!match || (match[3] && match[1] !== 'ISO')) return undefined
    return `${match[1]} ${Number(match[2])}${match[3] ?? ''}`
}

const lookup =
    <Canonical extends string>(names: Readonly<Record<string, Canonical>>) =>
    (label: string): Canonical | undefined =>
        Object.prototype.hasOwnProperty.call(names, label) ? names[label] : undefined

/** Thousandths of a stop, the standard PTP ExposureBiasCompensation unit. */
const thousandthsOfAStop = (label: string) =>
    /^-?\d+$/.test(label.trim()) ? formatExposureCompensation(Number(label) / 1000) : undefined

/** A signed stop count, with or without Sony's `EV` suffix (`+0.3 EV`, `-1`, `0.7`). */
const signedStops = (label: string) => {
    const match = /^([+-]?\d+(?:\.\d+)?)(?:\s*EV)?$/i.exec(label.trim())
    return match ? formatExposureCompensation(Number(match[1])) : undefined
}

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

/**
 * Sony PTP exposure programs: a family prefix (photo, `Movie `, `S&Q `, `Interval Movie `) and a
 * mode. Only the current family's modes are offered: changing family is photo/video, not exposure.
 */
const sonyFamilies = ['Interval Movie ', 'Movie / S&Q ', 'Movie ', 'S&Q '] as const
const sonyModes = lookup<ExposureMode>({
    Manual: 'Manual',
    'Program Auto': 'Program',
    'Aperture Priority': 'Aperture priority',
    'Shutter Priority': 'Shutter priority',
    Auto: 'Auto',
    'Flexible Exposure': 'Flexible priority',
})
const sonyExposureMode: ControlValueVocabulary = {
    canonical: label => sonyModes(label.replace(new RegExp(`^(?:${sonyFamilies.join('|')})`), '')),
    family: label => sonyFamilies.find(family => label.startsWith(family)) ?? 'photo',
}

/** Sony Camera Remote SDK ExposureProgramMode labels (`M Manual`, `Movie A`, `SQMotion S`, ...). */
const sonySdkFamilies = ['Movie SQMotion ', 'HiFrameRate ', 'SQMotion ', 'Movie '] as const
const sonySdkModes = lookup<ExposureMode>({
    'M Manual': 'Manual',
    M: 'Manual',
    'P Auto': 'Program',
    P: 'Program',
    'A AperturePriority': 'Aperture priority',
    A: 'Aperture priority',
    'S ShutterSpeedPriority': 'Shutter priority',
    S: 'Shutter priority',
    Auto: 'Auto',
    AUTO: 'Auto',
    F: 'Flexible priority',
    'F Mode': 'Flexible priority',
})
const sonySdkExposureMode: ControlValueVocabulary = {
    canonical: label => sonySdkModes(label.replace(new RegExp(`^(?:${sonySdkFamilies.join('|')})`), '')),
    family: label => sonySdkFamilies.find(family => label.startsWith(family)) ?? 'photo',
}

const sonyMetering = lookup<MeteringMode>({
    Multi: 'Multi',
    Center: 'Center-weighted',
    'Entire Screen Avg.': 'Average',
    'Spot: Standard': 'Spot',
    'Spot: Large': 'Large spot',
    Highlight: 'Highlight',
})

/**
 * Sony SDK CrMeteringMode values 5–10, the ones the bench matched to PTP 0x8001–0x8006 (see the Sony
 * ExposureMeteringMode codec); 1–4 duplicate them in the SDK header and are left unnamed.
 */
const sonySdkMetering = lookup<MeteringMode>({
    '5': 'Multi',
    '6': 'Center-weighted',
    '7': 'Average',
    '8': 'Spot',
    '9': 'Large spot',
    '10': 'Highlight',
})

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

/** ISO 15740 ExposureProgramMode names, as the standard codec spells them. */
const standardModes = {
    Manual: 'Manual',
    'Program Auto': 'Program',
    'Aperture Priority': 'Aperture priority',
    'Shutter Priority': 'Shutter priority',
    Auto: 'Auto',
} as const satisfies Record<string, ExposureMode>

/** ISO 15740 ExposureMeteringMode: 1 average, 2 centre-weighted, 3 multi-spot, 4 centre-spot. */
const standardMetering = { '1': 'Average', '2': 'Center-weighted', '3': 'Multi', '4': 'Spot' } as const

/** Nikon reports its automatic mode and highlight-weighted metering as vendor values 0x8010. */
const nikonExposureMode = lookup<ExposureMode>({ ...standardModes, 'Mode 0x8010': 'Auto' })
const nikonMetering = lookup<MeteringMode>({ ...standardMetering, '32784': 'Highlight' })

const standardValues = {
    aperture: { canonical: fNumber },
    iso: { canonical: isoLabel },
    exposureMode: { canonical: lookup<ExposureMode>(standardModes) },
    exposureCompensation: { canonical: thousandthsOfAStop },
    meteringMode: { canonical: lookup<MeteringMode>(standardMetering) },
} as const satisfies Partial<Record<ExposureId, ControlValueVocabulary>>

const nikonValues = {
    ...standardValues,
    exposureMode: { canonical: nikonExposureMode },
    meteringMode: { canonical: nikonMetering },
} as const satisfies Partial<Record<ExposureId, ControlValueVocabulary>>

/**
 * Each vendor's words for the exposure settings, mapped to the canonical names of
 * `@camera/settings/exposure`. A word with no canonical name is left out of the choices and never
 * written; a current value with none reads as unrecognized.
 */
export const exposureControlValues = {
    sony: {
        aperture: { canonical: fNumber },
        iso: { canonical: isoLabel },
        exposureMode: sonyExposureMode,
        exposureCompensation: { canonical: signedStops },
        meteringMode: { canonical: sonyMetering },
    },
    sonySdk: {
        aperture: { canonical: fNumber },
        iso: { canonical: label => isoLabel(/^\d/.test(label) ? `ISO ${label}` : label) },
        exposureMode: sonySdkExposureMode,
        exposureCompensation: { canonical: signedStops },
        meteringMode: { canonical: sonySdkMetering },
    },
    canon: {
        // 0x0000 (implicit auto in Tv/P), 0xffff and 0x00b0 are all `auto` in the Canon codec: read, never written.
        aperture: { canonical: fNumber, readOnly: ['Auto'] },
        iso: { canonical: label => (/^auto(?:_iso)?$/.test(label) ? 'Auto' : isoLabel(`ISO ${label}`)) },
        exposureMode: { canonical: canonExposureMode },
        exposureCompensation: { canonical: canonEighthsOfAStop },
        meteringMode: { canonical: canonMetering },
    },
    standard: standardValues,
    nikonPhoto: nikonValues,
    nikonMovie: nikonValues,
} as const satisfies VendorControlValues<ExposureId>
