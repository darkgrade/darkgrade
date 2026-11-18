import { HoverTip } from '@renderer/components/HoverTip'
import { perf, takePerf } from '@renderer/lib/perf'
import type { PerfReport, PerfTrace, ProcessSample } from '@shared/ipc'
import { Activity } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Developer Mode's performance monitor, after Fairway Atlas's: a card at the foot of the sidebar with the frame rate
 * and Studio's CPU and GPU, opening a window of its own with every process Studio runs and, inside the Studio window,
 * what its time goes to. Each row shows CPU and GPU side by side, each with a live graph of the last minute; numbers
 * refresh every second and every three seconds the rows slide into order of cost. The detailed timing in the Studio
 * window runs only while the monitor window is open.
 */

const HISTORY = 60
const SAMPLE_MS = 1000
const RESORT_MS = 3000

/** Frames the page drew over the last second (requestAnimationFrame). */
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

function percent(value: number | null): string {
    if (value === null) return '—'
    return value >= 10 ? `${Math.round(value)}%` : `${value.toFixed(1)}%`
}

const CPU_COLOUR = 'var(--gold)'
const GPU_COLOUR = 'oklch(0.75 0.12 240)'

/** A minute of one value as a filled line, on its column's scale so rows compare at a glance. */
function Spark(props: { values: number[]; colour: string; peak: number; width?: number }): React.JSX.Element {
    const width = props.width ?? 120
    const height = 24
    const { values } = props
    const x = (index: number): number => width - (values.length - 1 - index) * (width / (HISTORY - 1))
    const y = (value: number): number => height - 1 - (value / props.peak) * (height - 3)
    const line = values
        .map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)},${y(value).toFixed(1)}`)
        .join('')
    return (
        <svg width={width} height={height} className="shrink-0" aria-hidden>
            {values.length > 1 && (
                <>
                    <path
                        d={`${line}L${x(values.length - 1)},${height}L${x(0)},${height}Z`}
                        fill={props.colour}
                        opacity={0.14}
                    />
                    <path d={line} fill="none" stroke={props.colour} strokeWidth={1.25} strokeLinejoin="round" />
                </>
            )}
        </svg>
    )
}

/** The top of a column's graphs: a quarter above the largest value any row reached in the last minute (at least 5%). */
function peakOf(histories: number[][]): number {
    return Math.max(5, ...histories.flat()) * 1.25
}

// ---------- the card in the Studio window

/** Events from the main process, by what they carry. */
const IPC_LABELS: Record<string, string> = {
    'evt:liveview-frame': 'Live frames arriving',
    'evt:state': 'Camera state updates',
    'evt:focus-frames': 'Focus frames arriving',
    'evt:osd-frame': "The camera's display arriving",
    'evt:log': 'Activity log entries',
    'evt:voice-status': 'Voice engine status',
    'evt:assistant-status': 'Assistant status',
    'evt:files': 'Card file list',
    'evt:perf-report': 'Performance reports',
}

const SUBSYSTEM_DETAILS: Record<string, string> = {
    'Live frame decode': 'JPEG to pixels, on a decoder thread; time from asking to having it',
    'Live frame upload to the GPU': 'copying the decoded frame into the shared texture',
    'React rendering': 'components re-rendering (reported by development builds only)',
    'Voice detector (worker thread)': 'Silero, in a worker, on every 32 ms of audio',
}

/** The Studio window's side: times its subsystems while the monitor window is open and sends the totals each second. */
function usePerfReporter(fps: number): void {
    const fpsRef = useRef(fps)
    fpsRef.current = fps
    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | undefined
        const enable = (enabled: boolean): void => {
            perf.enabled = enabled
            clearInterval(timer)
            // Start every count from now: events counted before were never measured over a second.
            takePerf()
            window.studio.perfTakeIpc()
            if (enabled)
                timer = setInterval(() => {
                    // Each IPC event type on its own: how often it arrives, how much it carries, and its handler.
                    const ipc = window.studio.perfTakeIpc().map(entry => ({
                        label: IPC_LABELS[entry.channel] ?? `Event: ${entry.channel.replace(/^evt:/, '')}`,
                        detail: `${entry.count} a second${entry.bytes ? ` · ${(entry.bytes / 1048576).toFixed(1)} MB/s` : ''} · receiving it and its handler`,
                        cpuPercent: entry.milliseconds / 10,
                        gpuPercent: null,
                    }))
                    void window.studio.perfReport({
                        fps: fpsRef.current,
                        subsystems: [
                            ...takePerf().map(({ label, cpuPercent, gpuPercent }) => ({
                                label,
                                detail: SUBSYSTEM_DETAILS[label],
                                cpuPercent,
                                gpuPercent,
                            })),
                            ...ipc,
                        ],
                    })
                }, SAMPLE_MS)
        }
        // A reply that lands after this effect was cleaned up must not start a second reporter.
        let active = true
        void window.studio.perfIsOpen().then(result => active && result.ok && enable(result.data))
        const unsubscribe = window.studio.onPerfEnabled(enable)
        return () => {
            active = false
            unsubscribe()
            enable(false)
        }
    }, [])
}

export function PerfCard(): React.JSX.Element {
    const fps = useFrameRate()
    usePerfReporter(fps)
    const [totals, setTotals] = useState<{ cpu: number[]; gpu: number[] }>({ cpu: [], gpu: [] })
    useEffect(() => {
        const sample = async (): Promise<void> => {
            const result = await window.studio.perfSampleProcesses()
            if (!result.ok) return
            const ours = result.data.filter(entry => !entry.outside)
            const sum = (key: 'cpuPercent' | 'gpuPercent'): number =>
                ours.reduce((total, entry) => total + entry[key], 0)
            setTotals(previous => ({
                cpu: [...previous.cpu, sum('cpuPercent')].slice(-HISTORY),
                gpu: [...previous.gpu, sum('gpuPercent')].slice(-HISTORY),
            }))
        }
        void sample()
        const timer = setInterval(() => void sample(), SAMPLE_MS)
        // The backtick opens the monitor, as in Fairway Atlas, while nothing editable has focus.
        const onKey = (event: KeyboardEvent): void => {
            if ((event.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]')) return
            if (event.key === '`') void window.studio.perfOpen()
        }
        window.addEventListener('keydown', onKey)
        return () => {
            clearInterval(timer)
            window.removeEventListener('keydown', onKey)
        }
    }, [])
    return (
        <div className="shrink-0 px-3 pb-3">
            <HoverTip
                tip="Open the performance monitor (`)"
                render={
                    <button
                        type="button"
                        onClick={() => void window.studio.perfOpen()}
                        className="flex w-full items-center gap-2.5 rounded-lg bg-foreground/5 px-2.5 py-1.5 text-left hover:bg-foreground/8"
                    />
                }
            >
                <Activity className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="font-mono text-[12px] whitespace-nowrap text-foreground tabular-nums">{fps} fps</span>
                <span className="font-mono text-[12px] whitespace-nowrap text-muted-foreground tabular-nums">
                    CPU {percent(totals.cpu.at(-1) ?? null)} · GPU {percent(totals.gpu.at(-1) ?? null)}
                </span>
            </HoverTip>
        </div>
    )
}

// ---------- the monitor window

interface Row {
    key: string
    label: string
    detail?: string
    /** null where this row has no such cost (or it can't be measured), shown as a dash. */
    cpu: number | null
    gpu: number | null
    cpuHistory: number[]
    gpuHistory: number[]
}

function push(history: number[] | undefined, value: number | null): number[] {
    return value === null ? (history ?? []) : [...(history ?? []), value].slice(-HISTORY)
}

/** Rows that slide into their new places when the order changes, rather than jumping. */
function Table(props: { title: string; note: string; rows: Row[]; order: string[] }): React.JSX.Element | null {
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
    }, [props.order])
    if (!props.rows.length) return null
    const byKey = new Map(props.rows.map(row => [row.key, row]))
    const cpuPeak = peakOf(props.rows.filter(row => row.key !== 'total').map(row => row.cpuHistory))
    const gpuPeak = peakOf(props.rows.filter(row => row.key !== 'total').map(row => row.gpuHistory))
    return (
        <section className="flex flex-col gap-1">
            <header className="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,180px)] items-baseline gap-6 px-1">
                <div className="flex items-baseline gap-2">
                    <h2 className="text-[14px] font-semibold text-foreground">{props.title}</h2>
                    <span className="truncate text-[11px] text-muted-foreground">{props.note}</span>
                </div>
                <span className="text-right text-[11px] font-medium text-muted-foreground">CPU · % of a core</span>
                <span className="text-right text-[11px] font-medium text-muted-foreground">GPU · % of the GPU</span>
            </header>
            <ol ref={listRef} className="flex flex-col rounded-xl bg-(--card-surface) py-1">
                {props.order
                    .map(key => byKey.get(key))
                    .filter(row => row !== undefined)
                    .map(row => (
                        <li
                            key={row.key}
                            data-key={row.key}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)_minmax(0,180px)] items-center gap-6 px-4 py-2"
                        >
                            <div className="flex min-w-0 flex-col">
                                <span className="truncate text-[13px] text-foreground">{row.label}</span>
                                {row.detail && (
                                    <span className="truncate text-[11px] text-muted-foreground">{row.detail}</span>
                                )}
                            </div>
                            {(['cpu', 'gpu'] as const).map(unit => (
                                <div key={unit} className="flex items-center justify-end gap-3">
                                    <Spark
                                        values={unit === 'cpu' ? row.cpuHistory : row.gpuHistory}
                                        colour={unit === 'cpu' ? CPU_COLOUR : GPU_COLOUR}
                                        peak={
                                            row.key === 'total'
                                                ? peakOf([unit === 'cpu' ? row.cpuHistory : row.gpuHistory])
                                                : unit === 'cpu'
                                                  ? cpuPeak
                                                  : gpuPeak
                                        }
                                        width={110}
                                    />
                                    <span
                                        className={`w-12 shrink-0 text-right font-mono text-[12px] tabular-nums ${row[unit] === null ? 'text-muted-foreground' : 'text-foreground'}`}
                                    >
                                        {percent(row[unit])}
                                    </span>
                                </div>
                            ))}
                        </li>
                    ))}
            </ol>
        </section>
    )
}

/**
 * A few seconds of Chromium's own trace, on demand: the busiest tasks in the GPU process, the main process and the
 * Studio window, for what the per-feature rows can't see inside (compositing, above all).
 */
function TraceSection(): React.JSX.Element {
    const [state, setState] = useState<{ running: boolean; trace: PerfTrace | null; error: string | null }>({
        running: false,
        trace: null,
        error: null,
    })
    const run = async (): Promise<void> => {
        setState(previous => ({ ...previous, running: true, error: null }))
        const result = await window.studio.perfTrace(3)
        setState(
            result.ok
                ? { running: false, trace: result.data, error: null }
                : { running: false, trace: null, error: result.error }
        )
    }
    const groups = new Map<string, PerfTrace['tasks']>()
    for (const task of state.trace?.tasks ?? []) groups.set(task.process, [...(groups.get(task.process) ?? []), task])
    return (
        <section className="flex flex-col gap-2">
            <header className="flex items-center justify-between gap-6 px-1">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h2 className="text-[14px] font-semibold text-foreground">Inside the processes</h2>
                    <span className="truncate text-[11px] text-muted-foreground">
                        Chromium's own trace: the busiest tasks, by the code that ran them
                    </span>
                </div>
                <button
                    type="button"
                    disabled={state.running}
                    onClick={() => void run()}
                    className="shrink-0 rounded-md bg-foreground/8 px-2.5 py-1 text-[12px] text-foreground hover:bg-foreground/12 disabled:opacity-60"
                >
                    {state.running ? 'Tracing…' : state.trace ? 'Trace again' : 'Trace 3 seconds'}
                </button>
            </header>
            {state.error && <p className="px-1 text-[12px] text-destructive">{state.error}</p>}
            {state.trace && (
                <>
                    {[...groups].map(([process, tasks]) => (
                        <div key={process} className="flex flex-col rounded-xl bg-(--card-surface) py-1">
                            <div className="px-4 pt-2 pb-1 text-[12px] font-semibold text-foreground">{process}</div>
                            {tasks.slice(0, 10).map(task => (
                                <div
                                    key={`${task.thread}|${task.task}`}
                                    className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-6 px-4 py-1"
                                >
                                    <div className="flex min-w-0 flex-col">
                                        <span className="truncate font-mono text-[12px] text-foreground">
                                            {task.task}
                                        </span>
                                        <span className="truncate text-[11px] text-muted-foreground">
                                            {task.thread}
                                        </span>
                                    </div>
                                    <span className="w-14 text-right font-mono text-[12px] text-foreground tabular-nums">
                                        {percent(task.percent)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ))}
                    <p className="px-1 text-[11px] text-muted-foreground">
                        % of a core over the {state.trace.seconds} s traced, each task less the tasks inside it.
                        {!state.trace.cpuTimed &&
                            ' Some tasks had no CPU time recorded: theirs is time spent, waits included.'}
                    </p>
                </>
            )}
        </section>
    )
}

export function PerfWindow(): React.JSX.Element {
    const [features, setFeatures] = useState<Row[]>([])
    const [processes, setProcesses] = useState<Row[]>([])
    const [windowServer, setWindowServer] = useState<ProcessSample | null>(null)
    const [fps, setFps] = useState<number | null>(null)
    const [orders, setOrders] = useState<{ features: string[]; processes: string[] }>({ features: [], processes: [] })
    const histories = useRef(new Map<string, { cpu: number[]; gpu: number[] }>())
    const report = useRef<PerfReport | null>(null)
    const lastSort = useRef(0)

    useEffect(() => window.studio.onPerfReport(next => (report.current = next)), [])

    useEffect(() => {
        const row = (
            key: string,
            label: string,
            detail: string | undefined,
            cpu: number | null,
            gpu: number | null
        ): Row => {
            const before = histories.current.get(key)
            const history = { cpu: push(before?.cpu, cpu), gpu: push(before?.gpu, gpu) }
            histories.current.set(key, history)
            return { key, label, detail, cpu, gpu, cpuHistory: history.cpu, gpuHistory: history.gpu }
        }
        let latestReport: PerfReport | null = null
        const sample = async (): Promise<void> => {
            const result = await window.studio.perfSampleProcesses()
            if (!result.ok) return
            if (report.current) latestReport = report.current
            report.current = null
            if (latestReport) setFps(latestReport.fps)
            const ours = result.data.filter(entry => entry.kind !== 'windowserver')
            setWindowServer(result.data.find(entry => entry.kind === 'windowserver') ?? null)
            const of = (kind: ProcessSample['kind']): ProcessSample[] => ours.filter(entry => entry.kind === kind)
            const sum = (entries: ProcessSample[], key: 'cpuPercent' | 'gpuPercent'): number =>
                entries.reduce((total, entry) => total + entry[key], 0)
            const subsystems = latestReport?.subsystems ?? []
            const timedCpu = subsystems.reduce((total, entry) => total + entry.cpuPercent, 0)
            const timedGpu = subsystems.reduce((total, entry) => total + (entry.gpuPercent ?? 0), 0)

            // Each feature on its own, wherever it runs: the Studio window's own parts, then whole processes.
            const featureRows: Row[] = [
                row(
                    'total',
                    'All of Studio',
                    `${ours.length} processes`,
                    sum(ours, 'cpuPercent'),
                    sum(ours, 'gpuPercent')
                ),
                ...subsystems.map(entry =>
                    row(
                        `feature:${entry.label}`,
                        entry.label,
                        entry.detail ??
                            (entry.gpuPercent !== null
                                ? 'a draw loop in the Studio window: its JavaScript, and its passes on the GPU'
                                : undefined),
                        entry.cpuPercent,
                        entry.gpuPercent
                    )
                ),
            ]
            const studio = of('studio')
            if (studio.length)
                featureRows.push(
                    row(
                        'feature:page',
                        latestReport ? 'Unattributed page work' : 'Studio window',
                        latestReport
                            ? "the rest of the Studio window: style, layout, paint, garbage collection, timers; JavaScript can't time these"
                            : 'the whole window (its parts appear once it reports)',
                        Math.max(0, sum(studio, 'cpuPercent') - timedCpu),
                        null
                    )
                )
            const gpuProcess = of('gpu')
            if (gpuProcess.length)
                featureRows.push(
                    row(
                        'feature:compositing',
                        'Compositing',
                        "the GPU process putting Studio's windows together, beyond the draw loops above",
                        sum(gpuProcess, 'cpuPercent'),
                        Math.max(0, sum(gpuProcess, 'gpuPercent') - timedGpu)
                    )
                )
            const whole: [ProcessSample['kind'], string, string][] = [
                ['main', 'Camera, files and IPC', 'the main process'],
                ['speech', 'Speech engine', 'Python: turning speech into words'],
                ['assistant', 'Assistant model', 'llama-server: finding requests in the words'],
                ['utility', 'Electron services', 'audio, network and storage services'],
                ['settings', 'Settings window', 'its page'],
                ['monitor', 'This monitor', 'the performance window itself'],
                ['other', 'Other processes', 'anything else Studio started'],
            ]
            for (const [kind, label, detail] of whole) {
                const entries = of(kind)
                if (entries.length)
                    featureRows.push(
                        row(`feature:${kind}`, label, detail, sum(entries, 'cpuPercent'), sum(entries, 'gpuPercent'))
                    )
            }
            setFeatures(featureRows)
            setProcesses(
                ours.map(entry =>
                    row(
                        `process:${entry.pid}`,
                        entry.name,
                        `${entry.role} · ${Math.round(entry.memoryMegabytes)} MB · pid ${entry.pid}`,
                        entry.cpuPercent,
                        entry.gpuPercent
                    )
                )
            )
        }
        void sample()
        const timer = setInterval(() => void sample(), SAMPLE_MS)
        return () => clearInterval(timer)
    }, [])

    // Every three seconds the rows take the order of their cost (CPU and GPU together); new rows join at once.
    useEffect(() => {
        const cost = (row: Row): number => (row.key === 'total' ? Infinity : (row.cpu ?? 0) + (row.gpu ?? 0))
        const sorted = (rows: Row[]): string[] => [...rows].sort((a, b) => cost(b) - cost(a)).map(row => row.key)
        const due = performance.now() - lastSort.current >= RESORT_MS
        setOrders(previous => {
            const next = { ...previous }
            for (const [name, rows] of Object.entries({ features, processes }) as ['features' | 'processes', Row[]][]) {
                const known = previous[name]
                const changed = known.length !== rows.length || rows.some(row => !known.includes(row.key))
                if (due || changed) next[name] = sorted(rows)
            }
            return next
        })
        if (due) lastSort.current = performance.now()
    }, [features, processes])

    return (
        <div className="flex h-full flex-col">
            <header className="flex h-11 shrink-0 items-center justify-center text-[13px] font-semibold [-webkit-app-region:drag]">
                Performance
            </header>
            <main className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-6 pt-2 pb-8">
                <p className="px-1 text-[12px] text-muted-foreground">
                    The last minute, refreshed every second; rows re-sort by cost every 3 s.
                    {fps !== null && <> The Studio window is drawing {fps} frames a second.</>}
                </p>
                <Table
                    title="By feature"
                    note="each part of Studio on its own, wherever it runs"
                    rows={features}
                    order={orders.features}
                />
                {windowServer && (
                    <p className="-mt-4 px-1 text-[12px] text-muted-foreground">
                        Not counted above: WindowServer, which composites every app on screen, is using{' '}
                        {percent(windowServer.cpuPercent)} CPU and {percent(windowServer.gpuPercent)} GPU across all of
                        them. macOS doesn't say how much of that is Studio's.
                    </p>
                )}
                <Table
                    title="By process"
                    note="as Activity Monitor lists them"
                    rows={processes}
                    order={orders.processes}
                />
            </main>
        </div>
    )
}
