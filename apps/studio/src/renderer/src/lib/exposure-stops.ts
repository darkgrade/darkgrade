/**
 * Shared third-stop tables + stepping logic. Used by the exposure dial UI and
 * by relative voice commands ("raise the ISO", "faster shutter", "brighter").
 * One full photographic stop = 3 entries in these tables.
 */

export const STEPS_PER_STOP = 3

export const ISO_VALUES = [
    'auto',
    '50',
    '64',
    '80',
    '100',
    '125',
    '160',
    '200',
    '250',
    '320',
    '400',
    '500',
    '640',
    '800',
    '1000',
    '1250',
    '1600',
    '2000',
    '2500',
    '3200',
    '4000',
    '5000',
    '6400',
    '8000',
    '10000',
    '12800',
    '16000',
    '20000',
    '25600',
    '32000',
    '40000',
    '51200',
    '64000',
    '80000',
    '102400',
]

/** Ordered slow → fast: higher index = shorter exposure = darker. */
export const SHUTTER_VALUES = [
    'bulb',
    '30',
    '25',
    '20',
    '15',
    '13',
    '10',
    '8',
    '6',
    '5',
    '4',
    '3.2',
    '2.5',
    '2',
    '1.6',
    '1.3',
    '1',
    '0.8',
    '0.6',
    '0.5',
    '0.4',
    '1/3',
    '1/4',
    '1/5',
    '1/6',
    '1/8',
    '1/10',
    '1/13',
    '1/15',
    '1/20',
    '1/25',
    '1/30',
    '1/40',
    '1/50',
    '1/60',
    '1/80',
    '1/100',
    '1/125',
    '1/160',
    '1/200',
    '1/250',
    '1/320',
    '1/400',
    '1/500',
    '1/640',
    '1/800',
    '1/1000',
    '1/1250',
    '1/1600',
    '1/2000',
    '1/2500',
    '1/3200',
    '1/4000',
    '1/5000',
    '1/6400',
    '1/8000',
]

/** Ordered wide → narrow: higher index = smaller opening = darker. */
export const APERTURE_VALUES = [
    'f/1.2',
    'f/1.4',
    'f/1.6',
    'f/1.8',
    'f/2',
    'f/2.2',
    'f/2.5',
    'f/2.8',
    'f/3.2',
    'f/3.5',
    'f/4',
    'f/4.5',
    'f/5',
    'f/5.6',
    'f/6.3',
    'f/7.1',
    'f/8',
    'f/9',
    'f/10',
    'f/11',
    'f/13',
    'f/14',
    'f/16',
    'f/18',
    'f/20',
    'f/22',
]

/** Numeric value for log-scale nearest matching; null for specials (auto/bulb). */
export function isoToNumber(value: string): number | null {
    if (/auto/i.test(value)) return null
    const parsed = parseFloat(value.replace(/[^\d.]/g, ''))
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function shutterToNumber(value: string): number | null {
    const cleaned = value
        .toLowerCase()
        .replace(/["'s]|sec(onds?)?/g, '')
        .trim()
    if (cleaned.includes('bulb') || cleaned === 'b') return null
    if (cleaned.includes('/')) {
        const [numerator, denominator] = cleaned.split('/')
        const n = parseFloat(numerator || '1')
        const d = parseFloat(denominator || '1')
        if (Number.isFinite(n) && Number.isFinite(d) && d !== 0) return n / d
        return null
    }
    const parsed = parseFloat(cleaned)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
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
