import { HoverTip } from '@renderer/components/HoverTip'
import { perf, takePerf } from '@renderer/lib/perf'
import type { ProcessSample } from '@shared/ipc'
import { Activity, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Developer Mode's performance monitor, after Fairway Atlas's: a card at the foot of the sidebar with the frame rate
 * and Studio's total CPU, opening a panel of every process Studio runs and, inside the Studio window, what its time
 * goes to. Each row has a live graph of the last minute; numbers refresh every second and every three seconds the
 * rows slide into order of cost. Nothing is measured while Developer Mode is off; the detailed timing runs only while
 * the panel is open.
 */

const HISTORY = 60
const SAMPLE_MS = 1000
const RESORT_MS = 3000
const OPEN_KEY = 'studio.perf-open'

interface Row {
    key: string
    label: string
    detail?: string
    /** % of one core (CPU) or of the GPU's time. */
    value: number
    history: number[]
    unit: 'cpu' | 'gpu'
}

function push(history: number[] | undefined, value: number): number[] {
    return [...(history ?? []), value].slice(-HISTORY)
}

function percent(value: number): string {
    return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`
}

/** A minute of one row as a filled line, on its section's scale so rows compare at a glance. */
function Spark({ values, unit, peak }: { values: number[]; unit: Row['unit']; peak: number }): React.JSX.Element {
    const width = 96
    const height = 22
    const x = (index: number): number => width - (values.length - 1 - index) * (width / (HISTORY - 1))
    const y = (value: number): number => height - 1 - (value / peak) * (height - 3)
    const line = values
        .map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
        .join('')
    const colour = unit === 'gpu' ? 'oklch(0.75 0.12 240)' : 'var(--gold)'
    return (
        <svg width={width} height={height} className="shrink-0" aria-hidden>
            {values.length > 1 && (
                <>
                    <path
                        d={`${line}L${x(values.length - 1)},${height}L${x(0)},${height}Z`}
                        fill={colour}
                        opacity={0.14}
                    />
                    <path d={line} fill="none" stroke={colour} strokeWidth={1.25} strokeLinejoin="round" />
                </>
            )}
        </svg>
    )
}

/** Rows that slide into their new places when the order changes, rather than jumping. */
function SortedRows({ rows, order, peak }: { rows: Row[]; order: string[]; peak: number }): React.JSX.Element {
    const listRef = useRef<HTMLOListElement>(null)
    const positions = useRef(new Map<string, number>())
    useLayoutEffect(() => {
        const list = listRef.current
        if (!list) return
        for (const element of list.children as HTMLCollectionOf<HTMLElement>) {
            const key = element.dataset.key!
            const top = element.offsetTop
            const before = positions.current.get(key)
            positions.current.set(key, top)
            if (before === undefined || before === top) continue
            element.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }], {
                duration: 600,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            })
        }
    }, [order])
    const byKey = new Map(rows.map(row => [row.key, row]))
    return (
        <ol ref={listRef} className="flex flex-col">
            {order
                .map(key => byKey.get(key))
                .filter(row => row !== undefined)
                .map(row => (
                    <li key={row.key} data-key={row.key} className="flex items-center gap-3 py-1.5">
                        <div className="flex min-w-0 flex-1 flex-col">
                            <span className="truncate text-[12px] text-foreground">{row.label}</span>
                            {row.detail && (
                                <span className="truncate text-[11px] text-muted-foreground">{row.detail}</span>
                            )}
                        </div>
                        <Spark values={row.history} unit={row.unit} peak={peak} />
                        <span className="w-12 shrink-0 text-right font-mono text-[12px] text-foreground tabular-nums">
                            {percent(row.value)}
                        </span>
                    </li>
                ))}
        </ol>
    )
}

/** The top of a section's graphs: a quarter above the largest value any row reached in the last minute (at least 5%). */
function sectionPeak(rows: Row[]): number {
    return Math.max(5, ...rows.flatMap(row => row.history)) * 1.25
}

function Section(props: {
    title: string
    note: string
    rows: Row[]
    order: string[]
    peak?: number
}): React.JSX.Element | null {
    if (!props.rows.length) return null
    return (
        <section className="flex flex-col gap-1">
            <header className="flex items-baseline justify-between gap-3">
                <h3 className="text-[12px] font-semibold text-foreground">{props.title}</h3>
                <span className="text-[11px] text-muted-foreground">{props.note}</span>
            </header>
            <SortedRows rows={props.rows} order={props.order} peak={props.peak ?? sectionPeak(props.rows)} />
        </section>
    )
}

/** Frames the page drew over the last second (requestAnimationFrame), for the card. */
function useFrameRate(): number {
    const [fps, setFps] = useState(0)
    useEffect(() => {
        let frames = 0
        let handle = requestAnimationFrame(function tick() {
            frames++
            handle = requestAnimationFrame(tick)
        })
        const timer = setInterval(() => {
            setFps(frames)
            frames = 0
        }, 1000)
        return () => {
            cancelAnimationFrame(handle)
            clearInterval(timer)
        }
    }, [])
    return fps
}

export function PerfMonitor(): React.JSX.Element {
    const [open, setOpen] = useState(() => {
        try {
            return localStorage.getItem(OPEN_KEY) === '1'
        } catch {
            return false
        }
    })
    const fps = useFrameRate()
    const [processes, setProcesses] = useState<Row[]>([])
    const [inside, setInside] = useState<Row[]>([])
    const [gpu, setGpu] = useState<Row[]>([])
    const [orders, setOrders] = useState<Record<string, string[]>>({ processes: [], inside: [], gpu: [] })
    const histories = useRef(new Map<string, number[]>())
    const lastSort = useRef(0)

    useEffect(() => {
        try {
            localStorage.setItem(OPEN_KEY, open ? '1' : '0')
        } catch {
            // Not kept; the panel still opens and closes.
        }
    }, [open])

    // The backtick toggles the panel, as in Fairway Atlas, while nothing editable has focus.
    useEffect(() => {
        const onKey = (event: KeyboardEvent): void => {
            if ((event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
            if (event.key === '`') setOpen(value => !value)
            if (event.key === 'Escape') setOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [])

    useEffect(() => {
        let cancelled = false
        perf.enabled = open
        takePerf()
        const sample = async (): Promise<void> => {
            const result = await window.studio.perfSampleProcesses()
            if (cancelled || !result.ok) return
            const remember = (key: string, value: number): number[] => {
                const history = push(histories.current.get(key), value)
                histories.current.set(key, history)
                return history
            }
            const processRows: Row[] = result.data.map(entry => ({
                key: `process:${entry.name}`,
                label: entry.name,
                detail: `${entry.role} · ${Math.round(entry.memoryMegabytes)} MB`,
                value: entry.cpuPercent,
                history: remember(`process:${entry.name}`, entry.cpuPercent),
                unit: 'cpu',
            }))
            const total = result.data.reduce((sum, entry) => sum + entry.cpuPercent, 0)
            processRows.unshift({
                key: 'process:total',
                label: 'All of Studio',
                detail: `${result.data.length} processes, together`,
                value: total,
                history: remember('process:total', total),
                unit: 'cpu',
            })
            setProcesses(processRows)

            if (open) {
                const measured = takePerf()
                const renderer: ProcessSample | undefined = result.data.find(entry => entry.name === 'Studio window')
                const timed = measured.filter(entry => entry.cpuPercent > 0)
                const timedTotal = timed.reduce((sum, entry) => sum + entry.cpuPercent, 0)
                const insideRows: Row[] = timed.map(entry => ({
                    key: `cpu:${entry.label}`,
                    label: entry.label,
                    value: entry.cpuPercent,
                    history: remember(`cpu:${entry.label}`, entry.cpuPercent),
                    unit: 'cpu',
                }))
                if (renderer) {
                    const other = Math.max(0, renderer.cpuPercent - timedTotal)
                    insideRows.push({
                        key: 'cpu:other',
                        label: 'Other page work',
                        detail: 'React, layout, styles, microphone capture, IPC',
                        value: other,
                        history: remember('cpu:other', other),
                        unit: 'cpu',
                    })
                }
                setInside(insideRows)
                setGpu(
                    measured
                        .filter(entry => entry.gpuPercent > 0)
                        .map(entry => ({
                            key: `gpu:${entry.label}`,
                            label: entry.label,
                            value: entry.gpuPercent,
                            history: remember(`gpu:${entry.label}`, entry.gpuPercent),
                            unit: 'gpu',
                        }))
                )
            }
        }
        void sample()
        const timer = setInterval(() => void sample(), SAMPLE_MS)
        return () => {
            cancelled = true
            clearInterval(timer)
            perf.enabled = false
        }
    }, [open])

    // Every three seconds the rows take the order of their cost; new rows join at once.
    useEffect(() => {
        const sorted = (rows: Row[]): string[] => [...rows].sort((a, b) => b.value - a.value).map(row => row.key)
        const due = performance.now() - lastSort.current >= RESORT_MS
        setOrders(previous => {
            const next = { ...previous }
            for (const [name, rows] of Object.entries({ processes, inside, gpu })) {
                const known = previous[name] ?? []
                const missing = rows.some(row => !known.includes(row.key)) || known.length !== rows.length
                if (due || missing) next[name] = sorted(rows)
            }
            return next
        })
        if (due) lastSort.current = performance.now()
    }, [processes, inside, gpu])

    const total = processes.find(row => row.key === 'process:total')
    return (
        <div className="relative shrink-0 px-3 pb-3">
            <HoverTip
                tip="Performance (`)"
                render={
                    <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setOpen(value => !value)}
                        className="flex w-full items-center gap-2.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-left hover:bg-foreground/8"
                    />
                }
            >
                <Activity className="size-3.5 text-muted-foreground" aria-hidden />
                <span className="font-mono text-[12px] text-foreground tabular-nums">{fps} fps</span>
                <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
                    CPU {total ? percent(total.value) : '—'}
                </span>
                {total && (
                    <span className="ml-auto">
                        <Spark values={total.history} unit="cpu" peak={sectionPeak([total])} />
                    </span>
                )}
            </HoverTip>
            {open && (
                <section
                    role="dialog"
                    aria-label="Performance"
                    className="absolute bottom-3 left-full z-50 ml-3 flex max-h-[80vh] w-[420px] flex-col gap-4 overflow-y-auto rounded-xl bg-popover p-4 shadow-2xl ring-1 ring-foreground/10"
                >
                    <header className="flex items-center justify-between gap-3">
                        <div className="flex flex-col">
                            <h2 className="text-[14px] font-semibold text-foreground">Performance</h2>
                            <span className="text-[11px] text-muted-foreground">
                                100% is one full core · the last minute, re-sorted every 3 s
                            </span>
                        </div>
                        <button
                            type="button"
                            aria-label="Close"
                            onClick={() => setOpen(false)}
                            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/8 hover:text-foreground"
                        >
                            <X className="size-4" />
                        </button>
                    </header>
                    <Section
                        title="Processes"
                        note="CPU"
                        rows={processes}
                        order={orders.processes}
                        peak={sectionPeak(processes.filter(row => row.key !== 'process:total'))}
                    />
                    <Section
                        title="Inside the Studio window"
                        note="CPU of its renderer"
                        rows={inside}
                        order={orders.inside}
                    />
                    <Section title="GPU passes" note="GPU time" rows={gpu} order={orders.gpu} />
                    {!gpu.length && inside.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                            GPU times appear where the GPU reports pass timestamps.
                        </p>
                    )}
                </section>
            )}
        </div>
    )
}
