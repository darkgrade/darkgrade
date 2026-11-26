import type { ZoomSpeed } from '@camera/driver'

/**
 * How a Sony power-zoom lens moves at one speed, and how its ZoomDistance trails it. zoomTo starts
 * from the bench measurements and replaces them with what the lens does in this session.
 */
export interface ZoomMotion {
    /** Millimetres of focal length a second while driving. */
    rate: number
    /** Millimetres the lens goes on after the stop command. */
    coast: number
    /** How long before a new ZoomDistance value appears the lens was where it says. */
    lagMilliseconds: number
    /** Landings the coast and the lag were learned from; 0 while still the bench's. */
    coastSamples: number
    lagSamples: number
}

/**
 * Measured on the darkgrade01 a6700 (firmware 2.00) with the E PZ 16-50mm II, 2026-11-25: speed 1
 * 12–13 mm/s (about 20 near tele), speed 4 35–55 mm/s, speed 8 over 68 mm/s; after the stop it coasts
 * 2–4 mm at speed 1 (about 2.5 zooming in, 2–3 out) and 7–9 mm at speed 4. ZoomDistance changes every
 * 160–250 ms, in whole millimetres, and shows the lens about 0.25 s late (about 3 mm at speed 1).
 */
export const SONY_ZOOM_MOTION: Readonly<Record<ZoomSpeed, ZoomMotion>> = {
    slow: { rate: 13, coast: 2.5, lagMilliseconds: 250, coastSamples: 0, lagSamples: 0 },
    medium: { rate: 45, coast: 8, lagMilliseconds: 250, coastSamples: 0, lagSamples: 0 },
    fast: { rate: 70, coast: 12, lagMilliseconds: 250, coastSamples: 0, lagSamples: 0 },
}

/** The lens starts moving about this long after the camera accepts the zoom command. */
const ZOOM_MOTOR_START_MILLISECONDS = 50
/**
 * A stop sent sooner than this after the start may never engage the motor: on the darkgrade01 a6700
 * (2026-11-25, traces SUITE5b-3491b29a and Z5restore3-5ac3113a) a pulse of about 4 ms left the lens
 * where it was and zoomTo took it for a lens without power zoom, while 141 ms at speed 1 moved it
 * about 3 mm. No movement is stopped sooner, whatever the estimate says.
 */
const ZOOM_MINIMUM_PULSE_MILLISECONDS = 150
/** A rate is measured only over readings at least this far apart in time and focal length. */
const RATE_SPAN_MILLISECONDS = 250
const RATE_SPAN_MILLIMETRES = 2
/** What a landing may teach, relative to the bench's numbers; beyond, it is a misreading (a range end, a stale value). */
const RATE_BOUNDS = [0.4, 2.5] as const
const COAST_LIMIT = 4
const LAG_LIMIT = 4
/** Whole-millimetre readings: a landing up to this far behind the estimate is rounding, not motion. */
const READING_ROUNDING_MILLIMETRES = 1

/**
 * The shortest movement the lens makes: driving from when its motor starts to the end of the
 * shortest pulse, then its coast. A target closer than this cannot be reached without going past it.
 */
export function minimumZoomTravel(motion: ZoomMotion): number {
    return motion.coast + (motion.rate * (ZOOM_MINIMUM_PULSE_MILLISECONDS - ZOOM_MOTOR_START_MILLISECONDS)) / 1000
}

/**
 * Estimates where one zoom movement is from the readings so far: dead reckoning from the start
 * until ZoomDistance first changes, then from the newest reading, carried forward by the measured
 * rate over the reading's lag and the time since the value appeared.
 */
export class ZoomMovement {
    readonly #from: number
    readonly #sign: 1 | -1
    readonly #motion: ZoomMotion
    /** The bench numbers for this speed, which bound what a reading may teach. */
    readonly #reference: ZoomMotion
    readonly #startedAtMs: number
    #first?: { reading: number; atMs: number }
    #last?: { reading: number; atMs: number }
    #stoppedAtMs?: number

    constructor(from: number, sign: 1 | -1, motion: ZoomMotion, reference: ZoomMotion, startedAtMs: number) {
        this.#from = from
        this.#sign = sign
        this.#motion = motion
        this.#reference = reference
        this.#startedAtMs = startedAtMs
    }

    /** True once a reading differs from where the movement started. */
    get moved(): boolean {
        return this.#last !== undefined
    }

    /** One ZoomDistance read; only a new value counts, from when it was first seen. */
    observe(reading: number, atMs: number): void {
        if (this.#stoppedAtMs !== undefined || reading === (this.#last?.reading ?? this.#from)) return
        this.#last = { reading, atMs }
        this.#first ??= this.#last
    }

    /** True once the readings span enough time and focal length to measure the rate. */
    private get measured(): boolean {
        const [first, last] = [this.#first, this.#last]
        if (!first || !last || last.atMs - first.atMs < RATE_SPAN_MILLISECONDS) return false
        return (last.reading - first.reading) * this.#sign >= RATE_SPAN_MILLIMETRES
    }

    /** Millimetres a second, measured from the readings once they span enough; the motion's rate before. */
    get rate(): number {
        const [first, last] = [this.#first, this.#last]
        if (!first || !last || !this.measured) return this.#motion.rate
        const travelled = (last.reading - first.reading) * this.#sign
        const measured = travelled / ((last.atMs - first.atMs) / 1000)
        const reference = this.#reference.rate
        return Math.min(reference * RATE_BOUNDS[1], Math.max(reference * RATE_BOUNDS[0], measured))
    }

    /** Where the lens is estimated to be now, while it is driving. */
    position(nowMs: number): number {
        return this.read(nowMs) ?? this.reckoned(nowMs)
    }

    /** Dead reckoning, until a reading changes: the rate since the lens started moving. */
    private reckoned(nowMs: number): number {
        const driving = Math.max(0, nowMs - this.#startedAtMs - ZOOM_MOTOR_START_MILLISECONDS)
        return this.#from + (this.#sign * this.rate * driving) / 1000
    }

    /** From the newest reading, carried forward over its lag and the time since it appeared. */
    private read(nowMs: number): number | undefined {
        const last = this.#last
        if (!last) return undefined
        const since = this.#motion.lagMilliseconds + nowMs - last.atMs
        return last.reading + (this.#sign * this.rate * since) / 1000
    }

    /**
     * How long to keep driving so the lens comes to rest at `aim` after its coast, and never less than
     * the rest of ZOOM_MINIMUM_PULSE_MILLISECONDS; 0 means stop now.
     */
    millisecondsUntilStop(aim: number, nowMs: number): number {
        const minimum = Math.max(0, this.#startedAtMs + ZOOM_MINIMUM_PULSE_MILLISECONDS - nowMs)
        const short = (aim - this.position(nowMs)) * this.#sign - this.#motion.coast
        if (short <= 0) return minimum
        const notStarted = Math.max(0, this.#startedAtMs + ZOOM_MOTOR_START_MILLISECONDS - nowMs)
        return Math.max(minimum, (short / this.rate) * 1000 + notStarted)
    }

    /** The stop was sent on this movement's estimate; later reads no longer count. */
    stopped(atMs: number): void {
        this.#stoppedAtMs = atMs
    }

    /**
     * What this movement teaches, given where the lens came to rest. Stopped before any reading
     * changed, the distance past the dead reckoning is the coast; stopped on a reading, what the lens
     * covered beyond that estimate, less the coast, corrects the reading's lag. The first landing of each kind replaces the bench's number; later
     * ones average in. Undefined when the landing is implausible for this lens (a range end, a stale
     * read) or the stop was not on the estimate.
     */
    learn(landed: number): ZoomMotion | undefined {
        const stoppedAtMs = this.#stoppedAtMs
        if (stoppedAtMs === undefined) return undefined
        const motion = this.#motion
        const reference = this.#reference
        const blend = (old: number, observed: number, samples: number) =>
            samples === 0 ? observed : (old + observed) / 2
        const read = this.read(stoppedAtMs)
        if (read === undefined) {
            const past = (landed - this.reckoned(stoppedAtMs)) * this.#sign
            if (past < -READING_ROUNDING_MILLIMETRES || past > COAST_LIMIT * reference.coast) return undefined
            const coast = blend(motion.coast, Math.max(0, past), motion.coastSamples)
            return { ...motion, coast, coastSamples: motion.coastSamples + 1 }
        }
        // Measured from the estimate with the lag assumed so far; what the lag should have been:
        const past = (landed - read) * this.#sign
        const lagMilliseconds = motion.lagMilliseconds + ((past - motion.coast) / this.rate) * 1000
        if (lagMilliseconds < -(READING_ROUNDING_MILLIMETRES / this.rate) * 1000) return undefined
        if (lagMilliseconds > LAG_LIMIT * reference.lagMilliseconds) return undefined
        const lag = blend(motion.lagMilliseconds, Math.max(0, lagMilliseconds), motion.lagSamples)
        const rate = this.#first && this.#last !== this.#first ? (motion.rate + this.rate) / 2 : motion.rate
        return { ...motion, rate, lagMilliseconds: lag, lagSamples: motion.lagSamples + 1 }
    }
}
