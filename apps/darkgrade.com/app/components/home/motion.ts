/** 0..1, eased at both ends. */
export function smooth(value: number): number {
    const clamped = Math.min(1, Math.max(0, value))
    return clamped * clamped * (3 - 2 * clamped)
}

/** 0 before `start`, 1 after `end`, eased in between. */
export function between(value: number, start: number, end: number): number {
    return smooth((value - start) / (end - start))
}

export function mix(from: number, to: number, amount: number): number {
    return from + (to - from) * amount
}

/** Moves `current` towards `target`, covering the same share of the gap each second whatever the frame rate. */
export function approach(current: number, target: number, ratePerSecond: number, deltaSeconds: number): number {
    return target + (current - target) * Math.exp(-ratePerSecond * deltaSeconds)
}

/** Calls `onChange` whenever `read()` gives a new number, checked once a frame. Returns how to stop. */
export function watch(read: () => number, onChange: (value: number) => void): () => void {
    let last = Number.NaN
    let animationFrame = requestAnimationFrame(function check() {
        const value = read()
        if (value !== last) {
            last = value
            onChange(value)
        }
        animationFrame = requestAnimationFrame(check)
    })
    return () => cancelAnimationFrame(animationFrame)
}
