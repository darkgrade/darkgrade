import { preferences } from '@main/preferences'
import type { PerfReport, ProcessSample } from '@shared/ipc'
import { IPC_EVENTS } from '@shared/ipc'
import { app, BrowserWindow, screen, webContents } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
        .filter(entry => ours.has(entry.pid) || entry.pid === windowServer?.pid)
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

// ---------- the monitor's own window

const currentDir = fileURLToPath(new URL('.', import.meta.url))
let perfWindow: BrowserWindow | null = null

function studioWindows(): BrowserWindow[] {
    return BrowserWindow.getAllWindows().filter(window => window !== perfWindow && !window.isDestroyed())
}

/** The Studio window times its subsystems only while the monitor window is open. */
function announce(open: boolean): void {
    for (const window of studioWindows()) window.webContents.send(IPC_EVENTS.PerfEnabled, open)
}

export function receivePerfReport(report: PerfReport): void {
    lastReport = report
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
    perfWindow = new BrowserWindow({
        width,
        height,
        x: Math.round(area.x + area.width - width - 24),
        y: Math.round(area.y + (area.height - height) / 2),
        minWidth: 640,
        minHeight: 360,
        fullscreenable: false,
        title: 'Performance',
        ...(process.platform === 'darwin'
            ? {
                  vibrancy: preferences.get().windowMaterial,
                  visualEffectState: preferences.get().dimWhenInactive
                      ? ('followWindow' as const)
                      : ('active' as const),
                  backgroundColor: '#00000000',
              }
            : { backgroundColor: '#07090b' }),
        titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
        show: false,
        webPreferences: {
            preload: join(currentDir, '../preload/index.mjs'),
            contextIsolation: true,
            sandbox: false,
        },
    })
    perfWindow.once('ready-to-show', () => perfWindow?.show())
    perfWindow.on('closed', () => {
        perfWindow = null
        announce(false)
    })
    if (process.env.ELECTRON_RENDERER_URL) void perfWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}#perf`)
    else void perfWindow.loadFile(join(currentDir, '../renderer/index.html'), { hash: 'perf' })
    announce(true)
    if (lastReport) perfWindow.webContents.once('did-finish-load', () => lastReport && receivePerfReport(lastReport))
}
