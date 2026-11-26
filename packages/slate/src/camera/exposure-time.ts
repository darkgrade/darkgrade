/** Exposure duration is independent of the vendor's wire encoding or display spelling. */
export type ExposureTime =
    | { kind: 'duration'; seconds: number }
    | { kind: 'angle'; degrees: number }
    | { kind: 'bulb' | 'time' | 'flash-sync' | 'auto' }

export type ExposureTimeInput = ExposureTime | string

export interface ExposureContext {
    /** Actual capture rate, including fractional rates such as 24000/1001. Never inferred from a label. */
    framesPerSecond: number
}

export function parseExposureTime(input: ExposureTimeInput): ExposureTime {
    if (typeof input !== 'string') {
        if (!input || typeof input !== 'object') throw new Error('Invalid exposure time')
        if (input.kind === 'duration' && Number.isFinite(input.seconds) && input.seconds > 0)
            return { kind: 'duration', seconds: input.seconds }
        if (input.kind === 'angle' && Number.isFinite(input.degrees) && input.degrees > 0 && input.degrees <= 360)
            return { kind: 'angle', degrees: input.degrees }
        if (['bulb', 'time', 'flash-sync', 'auto'].includes(input.kind)) return { kind: input.kind } as ExposureTime
        throw new Error('Invalid exposure time')
    }
    const text = input.trim().replace(/\s+\(raw [^)]+\)$/, '')
    const special = text.toLowerCase().replace(/[\s_]+/g, '-')
    if (['bulb', 'b'].includes(special)) return { kind: 'bulb' }
    if (special === 'time') return { kind: 'time' }
    if (special === 'flash-sync') return { kind: 'flash-sync' }
    if (special === 'auto' || special === 'automatic') return { kind: 'auto' }
    const angle = /^(\d+(?:\.\d+)?)\s*(?:°|deg(?:rees)?)$/i.exec(text)
    if (angle) return parseExposureTime({ kind: 'angle', degrees: Number(angle[1]) })
    const duration = /^(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(?:s|sec(?:onds)?|")?$/i.exec(text)
    if (!duration || text.length > 100) throw new Error('Invalid exposure time')
    return parseExposureTime({ kind: 'duration', seconds: Number(duration[1]) / Number(duration[2] ?? 1) })
}

export function exposureSeconds(input: ExposureTimeInput, context?: ExposureContext): number | undefined {
    const value = parseExposureTime(input)
    if (value.kind === 'duration') return value.seconds
    if (value.kind !== 'angle') return undefined
    const seconds = value.degrees / (360 * checkedFrameRate(context))
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Exposure conversion is not representable')
    return seconds
}

function checkedFrameRate(context?: ExposureContext): number {
    if (!context || !Number.isFinite(context.framesPerSecond) || context.framesPerSecond <= 0)
        throw new Error('Converting shutter angle requires the actual framesPerSecond')
    return context.framesPerSecond
}

/** Equal within floating-point error, never a nearby camera setting. */
const nearlyEqual = (left: number, right: number) => Math.abs(left - right) <= Number.EPSILON * Math.max(left, right) * 8

/** Match an actual advertised value; do not round to a nearby camera setting. */
export function matchExposureTime(input: ExposureTimeInput, choices: readonly string[], context?: ExposureContext): string | undefined {
    const requested = parseExposureTime(input)
    for (const label of choices) {
        let candidate: ExposureTime
        try {
            candidate = parseExposureTime(label)
        } catch {
            continue
        }
        if (requested.kind === candidate.kind && requested.kind !== 'duration' && requested.kind !== 'angle') return label
        if (requested.kind === 'angle' && candidate.kind === 'angle') {
            if (nearlyEqual(requested.degrees, candidate.degrees)) return label
            continue
        }
        if (!['duration', 'angle'].includes(requested.kind) || !['duration', 'angle'].includes(candidate.kind)) continue
        if (nearlyEqual(exposureSeconds(requested, context)!, exposureSeconds(candidate, context)!)) return label
    }
    return undefined
}
