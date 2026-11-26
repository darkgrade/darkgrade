import { preferences } from '@main/preferences'
import { protectRenderer } from '@main/renderer-security'
import { createStudioWindow, studioRendererUrl, studioRouteUrl } from '@main/studio-window'
import type { PerfReport, PerfTrace, ProcessSample } from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'
import { app, BrowserWindow, contentTracing, screen, shell, webContents } from 'electron'
import { execFile } from 'node:child_process'
import { readFile, rm } from 'node:fs/promises'

/**
 * Developer Mode's performance monitor, main-process side: every process Studio runs (its own Electron processes and
 * the speech engine and assistant it starts), and WindowServer, which composites every app's windows, with the CPU and
 * GPU each used since the last sample. CPU comes from one `ps` call, GPU from the accumulated GPU time macOS keeps per
 * process (`ioreg`). Both are time used over time passed: 100% CPU is one full core, 100% GPU the whole GPU.
 */

interface Counters {
    cpuSeconds: number
    gpuNanoseconds: number
    at: number
}

let previous = new Map<number, Counters>()
let latest: { at: number; samples: Promise<ProcessSample[]> } | null = null
/** The Studio window's own breakdown, relayed to the monitor window. */
let lastReport: PerfReport | null = null

function run(command: string, args: string[]): Promise<string> {
    return new Promise(resolve =>
        execFile(command, args, { maxBuffer: 16 * 1024 * 1024 }, (error, out) => resolve(error ? '' : out))
    )
}

function cpuSeconds(time: string): number {
    // ps prints [[dd-]hh:]mm:ss.ss
    const [days, rest] = time.includes('-') ? time.split('-') : ['0', time]
    return rest
        .split(':')
        .map(Number)
        .reduce((total, part) => total * 60 + part, Number(days) * 86400)
}

async function listProcesses(): Promise<{ pid: number; ppid: number; time: string; rss: number; args: string }[]> {
    return (await run('ps', ['-A', '-o', 'pid=,ppid=,time=,rss=,args=']))
        .split('\n')
        .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/))
        .filter(match => match !== null)
        .map(match => ({
            pid: Number(match[1]),
            ppid: Number(match[2]),
            time: match[3],
            rss: Number(match[4]),
            args: match[5],
        }))
}

/**
 * Each process's GPU time so far, in nanoseconds, from the GPU driver's clients (Apple silicon's AGX). Each client is
 * one block of ioreg's output, its usage listed before the process that created it, so a block is read whole.
 */
async function gpuTimes(): Promise<Map<number, number>> {
    const out = await run('ioreg', ['-r', '-d', '1', '-w0', '-c', 'AGXDeviceUserClient'])
    const times = new Map<number, number>()
    for (const block of out.split('+-o ')) {
        const creator = block.match(/"IOUserClientCreator" = "pid (\d+),/)
        if (!creator) continue
        const pid = Number(creator[1])
        for (const match of block.matchAll(/"accumulatedGPUTime"=(\d+)/g))
            times.set(pid, (times.get(pid) ?? 0) + Number(match[1]))
    }
    return times
}

/** What one of Studio's processes is, a readable name for it, and what it does. */
function describe(
    pid: number,
    args: string,
    metrics: Map<number, Electron.ProcessMetric>
): [ProcessSample['kind'], string, string] {
    if (pid === process.pid) return ['main', 'Main process', 'camera, files, IPC, menus']
    const metric = metrics.get(pid)
    if (metric?.type === 'GPU') return ['gpu', 'GPU process', "WebGPU and compositing for Studio's windows"]
    if (metric?.type === 'Tab') {
        const url = webContents
            .getAllWebContents()
            .find(contents => contents.getOSProcessId() === pid)
            ?.getURL()
        if (url?.includes('#preferences')) return ['settings', 'Settings window', 'its page']
        if (url?.includes('#perf')) return ['monitor', 'Performance window', 'this window']
        return ['studio', 'Studio window', 'the page: React, draw loops, voice detector']
    }
    if (metric?.type === 'Utility')
        return ['utility', metric.name ?? metric.serviceName ?? 'Utility', 'Electron service']
    if (/transcription_server\.py/.test(args)) return ['speech', 'Speech engine', 'Python: transcription']
    if (/llama-server/.test(args)) return ['assistant', 'Assistant model', 'llama-server: understanding requests']
    if (metric) return ['other', metric.name ?? metric.type, metric.type]
    return ['other', args.split(' ')[0].split('/').at(-1) ?? 'Process', 'started by Studio']
}

async function measure(): Promise<ProcessSample[]> {
    const [all, gpu] = await Promise.all([listProcesses(), gpuTimes()])
    const now = Date.now()
    const metrics = new Map(app.getAppMetrics().map(metric => [metric.pid, metric]))
    // Studio is the main process and everything started from it, however deep.
    const children = new Map<number, number[]>()
    for (const entry of all) children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry.pid])
    const ours = new Set<number>([process.pid])
    const queue = [process.pid]
    while (queue.length)
        for (const child of children.get(queue.pop()!) ?? []) if (!ours.has(child)) (ours.add(child), queue.push(child))
    const windowServer = all.find(entry => /\/WindowServer(\s|$)/.test(entry.args))

    const next = new Map<number, Counters>()
    const samples = all
        // The monitor's own ps and ioreg are Studio's children for a moment; they're not Studio's work.
        .filter(
            entry =>
                (ours.has(entry.pid) && !/^\(?(ps|ioreg)\)?(\s|$)/.test(entry.args)) || entry.pid === windowServer?.pid
        )
        .map(entry => {
            const counters = { cpuSeconds: cpuSeconds(entry.time), gpuNanoseconds: gpu.get(entry.pid) ?? 0, at: now }
            const before = previous.get(entry.pid)
            next.set(entry.pid, counters)
            const elapsed = before ? (now - before.at) / 1000 : 0
            const outside = entry.pid === windowServer?.pid
            const [kind, name, role]: [ProcessSample['kind'], string, string] = outside
                ? ['windowserver', 'WindowServer', 'macOS: composites every app on screen, not just Studio']
                : describe(entry.pid, entry.args, metrics)
            const rate = (delta: number): number => (before && elapsed > 0 ? Math.max(0, (delta / elapsed) * 100) : 0)
            return {
                pid: entry.pid,
                kind,
                name,
                role,
                outside,
                cpuPercent: rate(counters.cpuSeconds - (before?.cpuSeconds ?? 0)),
                gpuPercent: rate((counters.gpuNanoseconds - (before?.gpuNanoseconds ?? 0)) / 1e9),
                memoryMegabytes: entry.rss / 1024,
            }
        })
    previous = next
    return samples
}

/** The latest sample; callers within the same second share one, so the rates stay over whole seconds. */
export function sampleProcesses(): Promise<ProcessSample[]> {
    if (latest && Date.now() - latest.at < 900) return latest.samples
    latest = { at: Date.now(), samples: measure() }
    return latest.samples
}

/**
 * Measures for a few seconds, for MCP clients: every process's CPU and GPU over the whole span, and the Studio
 * window's own breakdown averaged over it (the window times its parts while this runs, as with the monitor open).
 */
export async function measurePerf(seconds: number): Promise<{
    seconds: number
    processes: Omit<ProcessSample, 'pid'>[]
    studioWindow: { fps: number; parts: PerfReport['subsystems'] } | null
}> {
    collecting = []
    announce(true)
    await sampleProcesses()
    latest = null
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    const processes = await sampleProcesses()
    const reports = collecting
    collecting = null
    announce(perfWindow !== null)
    const parts = new Map<string, { detail?: string; cpu: number; gpu: number | null; n: number }>()
    for (const report of reports)
        for (const part of report.subsystems) {
            const entry = parts.get(part.label) ?? {
                detail: part.detail,
                cpu: 0,
                gpu: part.gpuPercent === null ? null : 0,
                n: 0,
            }
            entry.cpu += part.cpuPercent
            if (entry.gpu !== null) entry.gpu += part.gpuPercent ?? 0
            entry.n++
            parts.set(part.label, entry)
        }
    const round = (value: number): number => Math.round(value * 10) / 10
    return {
        seconds,
        processes: processes.map(({ pid: _pid, ...rest }) => ({
            ...rest,
            cpuPercent: round(rest.cpuPercent),
            gpuPercent: round(rest.gpuPercent),
            memoryMegabytes: Math.round(rest.memoryMegabytes),
        })),
        studioWindow: reports.length
            ? {
                  fps: Math.round(reports.reduce((total, report) => total + report.fps, 0) / reports.length),
                  parts: [...parts]
                      .map(([label, entry]) => ({
                          label,
                          detail: entry.detail,
                          cpuPercent: round(entry.cpu / reports.length),
                          gpuPercent: entry.gpu === null ? null : round(entry.gpu / reports.length),
                      }))
                      .sort((a, b) => b.cpuPercent + (b.gpuPercent ?? 0) - a.cpuPercent - (a.gpuPercent ?? 0)),
              }
            : null,
    }
}

// ---------- a trace of what Studio's processes spend their time on

interface TraceEvent {
    ph: string
    name: string
    pid: number
    tid: number
    ts: number
    dur?: number
    tdur?: number
    args?: { name?: string; src_func?: string }
}

/**
 * Records Chromium's own trace for a few seconds and adds up each task's self time (its time less the tasks inside
 * it) per process: CPU time where the trace has it, else time spent. Tasks are named by the code that posted them.
 */
export async function tracePerf(seconds: number): Promise<PerfTrace> {
    await contentTracing.startRecording({
        included_categories: ['toplevel', 'viz', 'gpu', 'cc', 'skia', 'ipc', 'blink', 'v8'],
    })
    await new Promise(resolve => setTimeout(resolve, seconds * 1000))
    const path = await contentTracing.stopRecording()
    const events = (JSON.parse(await readFile(path, 'utf8')) as { traceEvents: TraceEvent[] }).traceEvents
    await rm(path, { force: true })
    const processNames = new Map<number, string>()
    const threadNames = new Map<string, string>()
    for (const event of events) {
        if (event.ph === 'M' && event.name === 'process_name') processNames.set(event.pid, event.args?.name ?? '')
        if (event.ph === 'M' && event.name === 'thread_name')
            threadNames.set(`${event.pid}:${event.tid}`, event.args?.name ?? '')
    }
    const studioPid = webContents
        .getAllWebContents()
        .find(contents => !contents.getURL().includes('#'))
        ?.getOSProcessId()
    const label = (pid: number): string | null => {
        const name = processNames.get(pid) ?? ''
        if (/GPU/i.test(name)) return 'GPU process'
        if (/Browser/i.test(name)) return 'Main process'
        if (pid === studioPid) return 'Studio window'
        return null
    }
    const totals = new Map<string, { process: string; thread: string; task: string; microseconds: number }>()
    const byThread = new Map<string, TraceEvent[]>()
    for (const event of events)
        if (event.ph === 'X' && event.dur !== undefined && label(event.pid))
            byThread.set(`${event.pid}:${event.tid}`, [...(byThread.get(`${event.pid}:${event.tid}`) ?? []), event])
    let cpuTimed = true
    for (const [thread, list] of byThread) {
        list.sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0))
        const stack: { end: number; key: string }[] = []
        for (const event of list) {
            while (stack.length && stack.at(-1)!.end <= event.ts) stack.pop()
            if (event.tdur === undefined) cpuTimed = false
            const time = event.tdur ?? event.dur ?? 0
            const process = label(event.pid)!
            const threadName = threadNames.get(thread) ?? 'thread'
            const task = event.args?.src_func ?? event.name
            const key = `${process}|${threadName}|${task}`
            const entry = totals.get(key) ?? { process, thread: threadName, task, microseconds: 0 }
            entry.microseconds += time
            totals.set(key, entry)
            const parent = stack.at(-1)
            if (parent) totals.get(parent.key)!.microseconds -= time
            stack.push({ end: event.ts + (event.dur ?? 0), key })
        }
    }
    return {
        seconds,
        cpuTimed,
        tasks: [...totals.values()]
            .filter(entry => entry.microseconds > 0)
            .sort((a, b) => b.microseconds - a.microseconds)
            .slice(0, 40)
            .map(entry => ({
                process: entry.process,
                thread: entry.thread,
                task: entry.task,
                percent: (entry.microseconds / (seconds * 1e6)) * 100,
            })),
    }
}

// ---------- the monitor's own window

let perfWindow: BrowserWindow | null = null

function studioWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter(window => window !== perfWindow && !window.isDestroyed())
}

/** The Studio window times its subsystems only while the monitor window is open. */
function announce(open: boolean): void {
    for (const window of studioWindows()) window.webContents.send(IPC_EVENTS.PerfEnabled, open)
}

/** Reports gathered for an MCP measurement, while one runs. */
let collecting: PerfReport[] | null = null

export function receivePerfReport(report: PerfReport): void {
    lastReport = report
    collecting?.push(report)
    if (perfWindow && !perfWindow.isDestroyed()) perfWindow.webContents.send(IPC_EVENTS.PerfReport, report)
}

export function perfMonitorOpen(): boolean {
    return perfWindow !== null
}

/** Opens the performance monitor in a window of its own, or brings it forward. */
export function openPerfWindow(): void {
    if (perfWindow) {
        perfWindow.show()
        perfWindow.focus()
        return
    }
    const studio = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const area = screen.getDisplayMatching(studio?.getBounds() ?? screen.getPrimaryDisplay().bounds).workArea
    const width = Math.min(960, area.width)
    const height = Math.min(760, area.height)
    perfWindow = createStudioWindow({
        width,
        height,
        x: Math.round(area.x + area.width - width - 24),
        y: Math.round(area.y + (area.height - height) / 2),
        minWidth: 640,
        minHeight: 360,
        fullscreenable: false,
        title: 'Performance',
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
    })
    perfWindow.once('ready-to-show', () => perfWindow?.show())
    perfWindow.on('closed', () => {
        perfWindow = null
        announce(false)
    })
    protectRenderer(perfWindow.webContents, studioRendererUrl, url => shell.openExternal(url))
    void perfWindow.loadURL(studioRouteUrl('perf'))
    announce(true)
    if (lastReport) perfWindow.webContents.once('did-finish-load', () => lastReport && receivePerfReport(lastReport))
}
