import type { ProcessSample } from '@shared/ipc'
import { app, webContents } from 'electron'
import { execFile } from 'node:child_process'

/**
 * Developer Mode's performance monitor, main-process side: every process Studio runs (its own Electron processes and
 * the speech engine and assistant it starts) with the CPU each used since the last sample, from one `ps` call. CPU is
 * the time a process spent on the CPU over the time that passed, so 100% is one full core, as Activity Monitor shows.
 */
let previous = new Map<number, { cpuSeconds: number; at: number }>()

function cpuSeconds(time: string): number {
    // ps prints [[dd-]hh:]mm:ss.ss
    const [days, rest] = time.includes('-') ? time.split('-') : ['0', time]
    return rest
        .split(':')
        .map(Number)
        .reduce((total, part) => total * 60 + part, Number(days) * 86400)
}

function listProcesses(): Promise<{ pid: number; ppid: number; time: string; rss: number; args: string }[]> {
    return new Promise(resolve =>
        execFile('ps', ['-A', '-o', 'pid=,ppid=,time=,rss=,args='], { maxBuffer: 8 * 1024 * 1024 }, (error, out) => {
            if (error) return resolve([])
            resolve(
                out
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
            )
        })
    )
}

/** A readable name for one of Studio's processes, and what it does. */
function describe(pid: number, args: string, metrics: Map<number, Electron.ProcessMetric>): [string, string] {
    if (pid === process.pid) return ['Main process', 'camera, files, IPC, menus']
    const metric = metrics.get(pid)
    if (metric?.type === 'GPU') return ['GPU process', 'WebGPU drawing and compositing the windows']
    if (metric?.type === 'Tab') {
        const contents = webContents.getAllWebContents().find(contents => contents.getOSProcessId() === pid)
        return contents?.getURL().includes('#preferences')
            ? ['Settings window', 'its page']
            : ['Studio window', 'the page: React, draw loops, voice detector']
    }
    if (metric?.type === 'Utility') return [metric.name ?? metric.serviceName ?? 'Utility', 'Electron service']
    if (/transcription_server\.py/.test(args)) return ['Speech engine', 'Python: transcription']
    if (/llama-server/.test(args)) return ['Assistant model', 'llama-server: understanding requests']
    if (metric) return [metric.name ?? metric.type, metric.type]
    return [args.split(' ')[0].split('/').at(-1) ?? 'Process', 'started by Studio']
}

export async function sampleProcesses(): Promise<ProcessSample[]> {
    const all = await listProcesses()
    const now = Date.now()
    const metrics = new Map(app.getAppMetrics().map(metric => [metric.pid, metric]))
    // Studio is the main process and everything started from it, however deep.
    const children = new Map<number, number[]>()
    for (const entry of all) children.set(entry.ppid, [...(children.get(entry.ppid) ?? []), entry.pid])
    const ours = new Set<number>([process.pid])
    const queue = [process.pid]
    while (queue.length)
        for (const child of children.get(queue.pop()!) ?? []) if (!ours.has(child)) (ours.add(child), queue.push(child))

    const next = new Map<number, { cpuSeconds: number; at: number }>()
    const samples = all
        .filter(entry => ours.has(entry.pid))
        .map(entry => {
            const seconds = cpuSeconds(entry.time)
            const before = previous.get(entry.pid)
            next.set(entry.pid, { cpuSeconds: seconds, at: now })
            const elapsed = before ? (now - before.at) / 1000 : 0
            const [name, role] = describe(entry.pid, entry.args, metrics)
            return {
                pid: entry.pid,
                name,
                role,
                cpuPercent: before && elapsed > 0 ? Math.max(0, ((seconds - before.cpuSeconds) / elapsed) * 100) : 0,
                memoryMegabytes: entry.rss / 1024,
            }
        })
    previous = next
    return samples
}
