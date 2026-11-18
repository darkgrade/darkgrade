/**
 * Developer Mode's performance monitor, renderer side: the page's own subsystems add the CPU time they spend (on the
 * main thread or a worker) and the GPU time their passes take, and the monitor takes the totals once a second.
 * Recording is off until the monitor opens, so nothing is measured or kept otherwise.
 */
interface Totals {
    cpuMs: number
    gpuMs: number
    count: number
    /** A draw loop: it has GPU passes, so its GPU column is shown even at zero. */
    draw: boolean
}

let totals = new Map<string, Totals>()
let since = performance.now()

export const perf = {
    enabled: false,
    /** CPU time a subsystem spent; `draw` for a draw loop, whose GPU time is reported too. */
    cpu(label: string, milliseconds: number, draw = false): void {
        if (!perf.enabled) return
        const entry = totals.get(label) ?? { cpuMs: 0, gpuMs: 0, count: 0, draw }
        entry.cpuMs += milliseconds
        entry.count++
        totals.set(label, entry)
    },
    /** GPU time a subsystem's passes took, from timestamp queries. */
    gpu(label: string, milliseconds: number): void {
        if (!perf.enabled) return
        const entry = totals.get(label) ?? { cpuMs: 0, gpuMs: 0, count: 0, draw: true }
        entry.gpuMs += milliseconds
        entry.draw = true
        totals.set(label, entry)
    },
}

/** Each subsystem's time since the last call, per second: CPU and GPU (null if it has none) as % of a core / the GPU. */
export function takePerf(): { label: string; cpuPercent: number; gpuPercent: number | null; perSecond: number }[] {
    const now = performance.now()
    const seconds = Math.max(0.001, (now - since) / 1000)
    since = now
    const taken = [...totals].map(([label, entry]) => ({
        label,
        cpuPercent: entry.cpuMs / seconds / 10,
        gpuPercent: entry.draw ? entry.gpuMs / seconds / 10 : null,
        perSecond: entry.count / seconds,
    }))
    totals = new Map()
    return taken
}
