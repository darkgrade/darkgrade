/**
 * Exposure stepping logic, used by the exposure dials and by the tools that adjust
 * exposure in stops. Steps move through the camera's own advertised choices.
 */
import { exposureSeconds, parseExposureTime } from '@darkgrade/slate/controls'

/** Numeric value for log-scale nearest matching; null for specials (auto/bulb). */
export function isoToNumber(value: string): number | null {
    if (/auto/i.test(value)) return null
    const parsed = parseFloat(value.replace(/[^\d.]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function shutterToNumber(value: string): number | null {
    try { return exposureSeconds(value) ?? null } catch { return null }
}

/** One dial contains the body's active unit; this never converts angle to seconds. */
export function shutterDialToNumber(value: string): number | null {
    try {
        const exposure = parseExposureTime(value)
        return exposure.kind === 'angle' ? exposure.degrees : exposure.kind === 'duration' ? exposure.seconds : null
    } catch { return null }
}

/** Preserve exact camera labels instead of generating third-stop values the body did not advertise. */
export function advertisedExposureValues(
    options: readonly string[] | undefined,
    toNumber: (value: string) => number | null,
    descending = false
): string[] {
    if (!options || new Set(options).size !== options.length) return []
    return [...options].sort((left, right) => {
        const a = toNumber(left), b = toNumber(right)
        if (a === null) return b === null ? 0 : -1
        if (b === null) return 1
        return descending ? b - a : a - b
    })
}

export function apertureToNumber(value: string): number | null {
    const parsed = parseFloat(value.toLowerCase().replace(/f\/?/, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** Index of the entry nearest to current on a log scale (exact string match wins). */
export function nearestIndex(
    values: string[],
    current: string | null,
    toNumber: (value: string) => number | null
): number {
    const fallback = Math.floor(values.length / 2)
    if (!current) return fallback
    const exact = values.findIndex(value => value.toLowerCase() === current.toLowerCase())
    if (exact >= 0) return exact
    const currentNumber = toNumber(current)
    if (currentNumber === null) return fallback
    let bestIndex = fallback
    let bestDistance = Infinity
    for (let index = 0; index < values.length; index++) {
        const candidate = toNumber(values[index])
        if (candidate === null) continue
        const distance = Math.abs(Math.log(candidate / currentNumber))
        if (distance < bestDistance) {
            bestDistance = distance
            bestIndex = index
        }
    }
    return bestIndex
}

/**
 * Steps `deltaIndices` third-stops from the current value. Returns the new
 * table entry, or null when the current value is a special (auto/bulb) that
 * cannot be stepped. Never steps INTO the special slot at index 0.
 */
export function stepValue(
    values: string[],
    current: string | null,
    toNumber: (value: string) => number | null,
    deltaIndices: number
): string | null {
    if (current && toNumber(current) === null) return null // auto / bulb
    const minIndex = toNumber(values[0]) === null ? 1 : 0
    const index = nearestIndex(values, current, toNumber)
    const nextIndex = Math.min(values.length - 1, Math.max(minIndex, index + deltaIndices))
    return values[nextIndex]
}

/** A setting the camera is choosing itself ("ISO AUTO"), so there is no value to step from. */
export function isAutoValue(value: string | null, toNumber: (value: string) => number | null): boolean {
    return !!value && /auto/i.test(value) && toNumber(value) === null
}

/** The option nearest `target` on a log scale, ignoring specials like auto and bulb; null when none is numeric. */
export function nearestNumericOption(
    options: string[],
    toNumber: (value: string) => number | null,
    target: number
): string | null {
    let best: string | null = null
    let bestDistance = Infinity
    for (const option of options) {
        const candidate = toNumber(option)
        if (!candidate) continue
        const distance = Math.abs(Math.log(candidate / target))
        if (distance < bestDistance) {
            best = option
            bestDistance = distance
        }
    }
    return best
}
