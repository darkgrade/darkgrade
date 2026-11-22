import { formatOverlayRate, RateMeter, startLatestFrameLoop } from '@renderer/lib/latest-frame-loop'
import { describe, expect, it } from 'vitest'

/** A promise and the function that settles it, for driving a model by hand. */
function deferred<Value>(): {
    promise: Promise<Value>
    resolve: (value: Value) => void
    reject: (error: Error) => void
} {
    let resolve!: (value: Value) => void
    let reject!: (error: Error) => void
    const promise = new Promise<Value>((settle, refuse) => {
        resolve = settle
        reject = refuse
    })
    return { promise, resolve, reject }
}

const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

describe('latest-frame loop', () => {
    it('keeps one frame in flight and takes only the newest when the model is free', async () => {
        let newestFrame = 1
        let takenFrame = 0
        const inferred: number[] = []
        const shown: number[] = []
        const pending: ReturnType<typeof deferred<number>>[] = []
        let inFlight = 0
        let mostInFlight = 0
        const stop = startLatestFrameLoop<number, number>({
            takeNewestFrame: async () => {
                if (newestFrame === takenFrame) return null
                takenFrame = newestFrame
                return newestFrame
            },
            infer: frame => {
                inferred.push(frame)
                inFlight++
                mostInFlight = Math.max(mostInFlight, inFlight)
                const request = deferred<number>()
                pending.push(request)
                return request.promise.finally(() => inFlight--)
            },
            show: result => shown.push(result),
            fail: () => {},
            waitForFrame: settle,
        })
        await settle()
        expect(inferred).toEqual([1])
        // Frames 2 to 5 arrive while frame 1 is still being worked on: none of them are queued.
        newestFrame = 5
        await settle()
        expect(inferred).toEqual([1])
        pending[0].resolve(1)
        await settle()
        await settle()
        expect(shown).toEqual([1])
        expect(inferred).toEqual([1, 5])
        pending[1].resolve(5)
        await settle()
        await settle()
        expect(shown).toEqual([1, 5])
        expect(mostInFlight).toBe(1)
        stop()
    })

    it('stops at the first failure and reports it once', async () => {
        const failures: string[] = []
        let calls = 0
        startLatestFrameLoop<number, number>({
            takeNewestFrame: async () => ++calls,
            infer: async () => {
                throw new Error('This model is gated: accept its licence first')
            },
            show: () => {},
            fail: message => failures.push(message),
            waitForFrame: settle,
        })
        await settle()
        await settle()
        expect(failures).toEqual(['This model is gated: accept its licence first'])
        expect(calls).toBe(1)
    })

    it('does not show a result that arrives after it was stopped', async () => {
        const request = deferred<number>()
        const shown: number[] = []
        const stop = startLatestFrameLoop<number, number>({
            takeNewestFrame: async () => 1,
            infer: () => request.promise,
            show: result => shown.push(result),
            fail: () => {},
            waitForFrame: settle,
        })
        await settle()
        stop()
        request.resolve(1)
        await settle()
        expect(shown).toEqual([])
    })
})

describe('overlay rate', () => {
    it('measures results per second across its window', () => {
        const meter = new RateMeter(3000)
        expect(meter.perSecond(0)).toBeNull()
        for (const time of [0, 250, 500, 750, 1000]) meter.record(time)
        expect(meter.perSecond(1000)).toBeCloseTo(4)
        // Old results fall out of the window.
        meter.record(4500)
        expect(meter.perSecond(4500)).toBeNull()
    })

    it('reads as frames per second and round trip', () => {
        expect(formatOverlayRate(4.18, 236.4)).toBe('4.2 fps · 236 ms')
        expect(formatOverlayRate(null, 236.4)).toBe('236 ms')
        expect(formatOverlayRate(null, null)).toBeNull()
    })
})
