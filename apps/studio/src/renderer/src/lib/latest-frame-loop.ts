import { errorMessage } from '@shared/format'

/**
 * Runs a model on the newest frame, over and over, with at most one frame in flight: frames that arrive while the
 * model is busy are never queued, only the newest is taken when it is free. So the overlay refreshes as fast as the
 * model sustains, and a slow model never falls behind the picture.
 */
export interface LatestFrameLoopOptions<Frame, Result> {
    /** The newest frame, or null when there is none newer than the last one taken. */
    takeNewestFrame: () => Promise<Frame | null>
    infer: (frame: Frame) => Promise<Result>
    show: (result: Result, roundTripMilliseconds: number) => void
    /** The model failed; the loop stops here, so a missing model isn't asked again and again. */
    fail: (message: string) => void
    /** Waits before looking for a frame again when there was no new one. */
    waitForFrame: () => Promise<void>
    now?: () => number
}

/** Starts the loop; the returned function stops it (a request in flight finishes, but its result isn't shown). */
export function startLatestFrameLoop<Frame, Result>(options: LatestFrameLoopOptions<Frame, Result>): () => void {
    const now = options.now ?? (() => performance.now())
    let running = true
    void (async () => {
        while (running) {
            const frame = await options.takeNewestFrame()
            if (!running) return
            if (frame === null) {
                await options.waitForFrame()
                continue
            }
            const startedMilliseconds = now()
            let result: Result
            try {
                result = await options.infer(frame)
            } catch (error) {
                if (running) options.fail(errorMessage(error))
                return
            }
            if (!running) return
            options.show(result, now() - startedMilliseconds)
        }
    })()
    return () => {
        running = false
    }
}

/** Results per second over a sliding window, for the overlay's readout. */
export class RateMeter {
    private times: number[] = []

    constructor(private readonly windowMilliseconds = 3000) {}

    record(nowMilliseconds: number): void {
        this.times.push(nowMilliseconds)
        this.forgetBefore(nowMilliseconds - this.windowMilliseconds)
    }

    /** Null until two results have arrived; otherwise their rate across the window (or since the first). */
    perSecond(nowMilliseconds: number): number | null {
        this.forgetBefore(nowMilliseconds - this.windowMilliseconds)
        if (this.times.length < 2) return null
        const spanMilliseconds = this.times[this.times.length - 1] - this.times[0]
        return spanMilliseconds > 0 ? ((this.times.length - 1) * 1000) / spanMilliseconds : null
    }

    private forgetBefore(oldestMilliseconds: number): void {
        while (this.times.length && this.times[0] < oldestMilliseconds) this.times.shift()
    }
}

/** An overlay's measured refresh rate and round trip, as its readouts show them ("4.2 fps · 236 ms"). */
export function formatOverlayRate(framesPerSecond: number | null, roundTripMilliseconds: number | null): string | null {
    if (roundTripMilliseconds === null) return null
    const rate = framesPerSecond === null ? '' : `${framesPerSecond.toFixed(1)} fps · `
    return `${rate}${Math.round(roundTripMilliseconds)} ms`
}
