import { formatAperture, formatExposureCompensation, type ExposureMode, type MeteringMode } from '@camera/settings/values'
import type { CodecType } from '@ptp/types/codec'
import * as standard from '@ptp/definitions/property-definitions'
import type {
    ControlPropertyMap,
    ControlValueNameTable,
    ControlValueTable,
} from '@vendors/control-properties'

/**
 * Standard PTP properties, for bodies without a vendor adapter: for each canonical id, the
 * properties that carry it in preference order. Typed definitions, so each setting's value type is
 * derived from the codecs (see `CodecValue`).
 */
export const standardControlProperties = {
    shutterSpeed: [standard.ExposureTime],
    iso: [standard.ExposureIndex],
    aperture: [standard.FNumber],
    exposureMode: [standard.ExposureProgramMode],
    exposureCompensation: [standard.ExposureBiasCompensation],
    meteringMode: [standard.ExposureMeteringMode],
    driveMode: [standard.StillCaptureMode],
    whiteBalance: [standard.WhiteBalance],
    focusMode: [standard.FocusMode],
    photoSize: [standard.ImageSize],
    flashMode: [standard.FlashMode],
} as const satisfies ControlPropertyMap

/** An f-number label (`f/2.8`, `F4.0`), or the `auto` Canon's codec names its automatic codes. */
export const fNumberLabel = (label: string) => {
    const text = label.trim()
    if (/^auto$/i.test(text)) return 'Auto'
    const match = /^f\/?(\d+(?:\.\d+)?)$/i.exec(text)
    return match ? formatAperture(Number(match[1])) : undefined
}

/** `ISO 800`, `ISO AUTO`, and Sony's distinct extended / Multi Frame NR sensitivities. */
export const isoLabel = (label: string) => {
    const text = label.trim()
    if (/^(?:iso\s*)?auto$/i.test(text)) return 'Auto'
    const match = /^(ISO|Multi Frame NR ISO|Multi Frame NR High ISO) (\d+)( \(extended\))?$/.exec(text)
    if (!match || (match[3] && match[1] !== 'ISO')) return undefined
    return `${match[1]} ${Number(match[2])}${match[3] ?? ''}`
}

export const lookup =
    <Canonical extends string>(names: Readonly<Record<string, Canonical>>) =>
    (label: string): Canonical | undefined =>
        Object.prototype.hasOwnProperty.call(names, label) ? names[label] : undefined

/** Thousandths of a stop, the standard PTP ExposureBiasCompensation unit. */
const thousandthsOfAStop = (label: string) =>
    /^-?\d+$/.test(label.trim()) ? formatExposureCompensation(Number(label) / 1000) : undefined

/** ISO 15740 ExposureProgramMode names, as the standard codec spells them. */
export const standardExposureModes = {
    Manual: 'Manual',
    'Program Auto': 'Program',
    'Aperture Priority': 'Aperture priority',
    'Shutter Priority': 'Shutter priority',
    Auto: 'Auto',
} as const satisfies Record<string, ExposureMode>

/** ISO 15740 ExposureMeteringMode: 1 average, 2 centre-weighted, 3 multi-spot, 4 centre-spot. */
export const standardMeteringModes = { '1': 'Average', '2': 'Center-weighted', '3': 'Multi', '4': 'Spot' } as const

/**
 * Standard PTP words for the exposure settings, mapped to the canonical names of
 * `@camera/settings/values`. A word with no canonical name is left out of the choices and never
 * written; a current value with none reads as unrecognized.
 */
export const standardControlValues = {
    aperture: { canonical: fNumberLabel },
    iso: { canonical: isoLabel },
    exposureMode: { canonical: lookup<ExposureMode>(standardExposureModes) },
    exposureCompensation: { canonical: thousandthsOfAStop },
    meteringMode: { canonical: lookup<MeteringMode>(standardMeteringModes) },
} as const satisfies ControlValueTable

/** PTP FocusMode (0x500a): manual, automatic, automatic macro. */
export const standardFocusModes = {
    Manual: 'MF',
    Automatic: 'AF',
    'Automatic Macro': 'AF macro',
} as const satisfies Readonly<Record<CodecType<typeof standard.FocusMode.codec>, string>>

/**
 * The canonical name of each standard value, per setting and property. The keys of each table are
 * its codec's names (checked against the codec), the values are what `getCapabilities` reports and
 * `setControl` accepts. A value missing from a table keeps the camera's own label.
 */
export const standardControlValueNames = {
    focusMode: { FocusMode: standardFocusModes },
} as const satisfies ControlValueNameTable
