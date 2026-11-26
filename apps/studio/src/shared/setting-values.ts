import { apertureToNumber, isoToNumber, shutterToNumber } from '@shared/exposure-stops'
import type { CameraControlName } from '@shared/ipc'

type SettingName = CameraControlName

const NUMERIC_READERS: Partial<Record<SettingName, (value: string) => number | null>> = {
    iso: isoToNumber,
    shutterSpeed: shutterToNumber,
    aperture: apertureToNumber,
    colorTemperature: value => {
        const parsed = parseFloat(value.replace(/[^\d.]/g, ''))
        return Number.isFinite(parsed) ? parsed : null
    },
}

function simplified(value: string): string {
    return value
        .toLowerCase()
        .replace(/[\s\-_]+/g, '')
        .replace(/^f\/?/, '')
        .replace(/(\.\d*?)0+$/, '$1')
        .replace(/\.$/, '')
}

/** Everyday words for values cameras abbreviate; tried when the word itself isn't one of the camera's choices. */
const VALUE_SYNONYMS: [RegExp, RegExp][] = [
    [/^manual( focus)?$/i, /^(MF|manual)/i],
    [/^(continuous|af-?c|tracking)( af| focus)?$/i, /^AF-?C/i],
    [/^(single|af-?s|one[- ]shot)( af| focus)?$/i, /^AF-?S/i],
    [/^auto(matic)?$/i, /^(auto|AWB|AF-?A)/i],
    [/^(kelvin|colou?r temp(erature)?)$/i, /temp|kelvin|K$/i],
    [/^(tungsten|incandescent)$/i, /tungsten|incandescent/i],
    [/^(daylight|sun(ny)?)$/i, /daylight|sun/i],
    [/^(movie|video|film|motion)( mode)?$/i, /^video$/],
    [/^(photo|still|stills|picture)( mode)?$/i, /^photo$/],
]

/** Finds the camera's own spelling of a requested value: "f/8" → "F8.0", "800" → "ISO 800", "manual" → "MF"; null when it offers no such value. */
export function matchOption(name: SettingName, requested: string, options: string[]): string | null {
    const synonym = VALUE_SYNONYMS.find(([word]) => word.test(requested.trim()))
    const viaSynonym = synonym && options.find(option => synonym[1].test(option))
    if (viaSynonym && !options.some(option => option.toLowerCase() === requested.toLowerCase())) return viaSynonym
    const exact = options.find(option => option.toLowerCase() === requested.toLowerCase())
    if (exact) return exact
    const loose = options.find(option => simplified(option) === simplified(requested))
    if (loose) return loose
    const contained = options.filter(option => option.toLowerCase().includes(requested.toLowerCase()))
    if (contained.length === 1) return contained[0]
    const toNumber = NUMERIC_READERS[name]
    const target = toNumber?.(requested)
    if (!toNumber || !target) return null
    // The same number spelled differently ("1/250s", "ISO1600"); a value the camera does not offer is never rounded to one it does.
    const equal = options.filter(option => toNumber(option) === target)
    return equal.length === 1 ? equal[0] : null
}
