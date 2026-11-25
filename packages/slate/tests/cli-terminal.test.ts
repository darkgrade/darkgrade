import type { Camera } from '@camera/index'
import { runBenchmarkCommand, type BenchmarkCommandDependencies, type DiscoveredCamera } from '@cli/benchmark'
import { attachedCameras, runCamerasCommand } from '@cli/cameras'
import { closestMatch } from '@cli/commands'
import { doctorChecks } from '@cli/doctor'
import { colorEnabled, createTerminal, type TerminalStreams } from '@cli/terminal'
import type { runBenchmark } from '@workflows/telemetry-benchmark'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'

const sony: DiscoveredCamera = { vendorId: 0x054c, productId: 0x0e78, model: 'ILCE-7M5' }
const fujifilm: DiscoveredCamera = { vendorId: 0x04cb, productId: 0x0305, model: 'X100VI' }

function streams(options: { terminal: boolean; environment?: Record<string, string | undefined> }) {
    const written = { output: '', error: '' }
    const input = Object.assign(new PassThrough(), { isTTY: options.terminal, setRawMode: () => undefined })
    const value: TerminalStreams = {
        input: input as unknown as TerminalStreams['input'],
        output: { isTTY: options.terminal, write: text => (written.output += text) },
        error: { isTTY: options.terminal, columns: 200, write: text => (written.error += text) },
        environment: options.environment ?? {},
    }
    return { value, written, input }
}
const flags = { noColor: false, noInput: false, noProgress: false, quiet: false }

afterEach(() => vi.useRealTimers())

describe('colour', () => {
    it('follows the flag, NO_COLOR, FORCE_COLOR, TERM=dumb and the stream, in that order', () => {
        expect(colorEnabled({ isTTY: true }, {}, false)).toBe(true)
        expect(colorEnabled({ isTTY: false }, {}, false)).toBe(false)
        expect(colorEnabled({ isTTY: true }, { NO_COLOR: '1' }, false)).toBe(false)
        expect(colorEnabled({ isTTY: true }, { NO_COLOR: '' }, false)).toBe(true)
        expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1' }, false)).toBe(true)
        expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: '0' }, false)).toBe(false)
        expect(colorEnabled({ isTTY: false }, { FORCE_COLOR: '1', NO_COLOR: '1' }, false)).toBe(false)
        expect(colorEnabled({ isTTY: true }, { TERM: 'dumb' }, false)).toBe(false)
        expect(colorEnabled({ isTTY: true }, { FORCE_COLOR: '1' }, true)).toBe(false)
    })
})

describe('terminal', () => {
    it('animates and asks only on a terminal that nothing has switched off', () => {
        expect(createTerminal(flags, streams({ terminal: true }).value)).toMatchObject({
            animated: true,
            interactive: true,
        })
        expect(createTerminal(flags, streams({ terminal: false }).value)).toMatchObject({
            animated: false,
            interactive: false,
        })
        for (const environment of [{ CI: 'true' }, { TERM: 'dumb' }])
            expect(createTerminal(flags, streams({ terminal: true, environment }).value)).toMatchObject({
                animated: false,
                interactive: false,
            })
        expect(
            createTerminal(flags, streams({ terminal: true, environment: { DARKGRADE_NO_SPINNER: '1' } }).value)
        ).toMatchObject({ animated: false, interactive: true })
        expect(createTerminal({ ...flags, noInput: true }, streams({ terminal: true }).value).interactive).toBe(false)
        expect(createTerminal({ ...flags, noProgress: true }, streams({ terminal: true }).value).animated).toBe(false)
    })

    it('draws a spinner on standard error, keeps notes above it and restores the cursor', () => {
        vi.useFakeTimers()
        const { value, written } = streams({ terminal: true })
        const progress = createTerminal(flags, value).progress()
        progress.update('Looking for a camera…')
        vi.advanceTimersByTime(200)
        progress.note('! photo-transfer')
        progress.stop()
        expect(written.output).toBe('')
        expect(written.error).toContain('\u001b[?25l')
        expect(written.error).toContain('⠙')
        expect(written.error).toContain('! photo-transfer\n')
        expect(written.error.endsWith('\r\u001b[2K\u001b[?25h')).toBe(true)
    })

    it('prints one plain line per change without a terminal, and nothing when quiet', () => {
        const piped = streams({ terminal: false })
        const progress = createTerminal(flags, piped.value).progress()
        progress.update('Connecting…')
        progress.update('Connecting…')
        progress.update('Reading…')
        progress.stop()
        expect(piped.written.error).toBe('Connecting…\nReading…\n')
        const quiet = streams({ terminal: false })
        createTerminal({ ...flags, quiet: true }, quiet.value)
            .progress()
            .update('Connecting…')
        expect(quiet.written.error).toBe('')
    })

    it('chooses with arrows or a number and cancels with Escape', async () => {
        const choices = [
            { label: 'ILCE-7M5', value: sony },
            { label: 'X100VI', value: fujifilm },
        ]
        const arrows = streams({ terminal: true })
        const byArrow = createTerminal(flags, arrows.value).select('Which one?', choices)
        arrows.input.write('\u001b[B')
        arrows.input.write('\r')
        expect(await byArrow).toBe(fujifilm)
        expect(arrows.written.error).toContain('Which one?')

        const digits = streams({ terminal: true })
        const byNumber = createTerminal(flags, digits.value).select('Which one?', choices)
        digits.input.write('1')
        expect(await byNumber).toBe(sony)

        const cancelled = streams({ terminal: true })
        const byEscape = createTerminal(flags, cancelled.value).select('Which one?', choices)
        cancelled.input.write('q')
        expect(await byEscape).toBeUndefined()
    })
})

describe('typo suggestions', () => {
    it('offers one close command and nothing for a different word or a tie', () => {
        expect(closestMatch('telemtry', ['telemetry', 'doctor'])).toBe('telemetry')
        expect(closestMatch('stats', ['status', 'whoami'])).toBe('status')
        expect(closestMatch('upload', ['telemetry', 'doctor'])).toBeUndefined()
        expect(closestMatch('opt-on', ['opt-in', 'opt-out'])).toBe('opt-in')
        expect(closestMatch('opt', ['opt-in', 'opt-out'])).toBeUndefined()
    })
})

function benchmarkHarness(devices: DiscoveredCamera[], extra: Partial<BenchmarkCommandDependencies>) {
    const printed: string[] = [],
        progress: string[] = [],
        created: DiscoveredCamera[] = []
    const dependencies: BenchmarkCommandDependencies = {
        discover: async () => devices,
        camerasInOtherModes: async () => [],
        createCamera: async device => {
            created.push(device)
            return { connect: async () => undefined, disconnect: async () => undefined } as unknown as Camera
        },
        runBenchmark: (async (_camera: Camera, options: { onProgress: (check: unknown) => void }) => {
            const checks = [
                { name: 'property-0x5001', passed: true, durationMilliseconds: 1 },
                { name: 'property-0xd001', passed: false, durationMilliseconds: 1, error: 'operation-failed' },
                { name: 'photo-transfer', passed: false, durationMilliseconds: 1, error: 'operation-failed' },
            ]
            checks.forEach(options.onProgress)
            return { passed: false, checks, profile: { id: 'id', status: 'partial' } }
        }) as unknown as typeof runBenchmark,
        saveProfile: () => '/profiles/id.json',
        flush: async () => 'sent',
        print: line => printed.push(line),
        progress: line => progress.push(line),
        ...extra,
    }
    return { dependencies, printed, progress, created }
}

describe('benchmark on a terminal', () => {
    it('asks which camera when several are attached, and opens nothing on cancel', async () => {
        const chosen = benchmarkHarness([sony, fujifilm], { choose: async devices => devices[1] })
        await runBenchmarkCommand([], chosen.dependencies)
        expect(chosen.created).toEqual([fujifilm])
        const cancelled = benchmarkHarness([sony, fujifilm], { choose: async () => undefined })
        expect(await runBenchmarkCommand([], cancelled.dependencies)).toBe(1)
        expect(cancelled.created).toEqual([])
        expect(cancelled.progress.join('\n')).toMatch(/Cancelled/)
    })

    it('shows checks on the status line, keeps only real failures, and clears it before the summary', async () => {
        const events: string[] = []
        const run = benchmarkHarness([sony], {
            status: text => events.push(`status ${text}`),
            clearStatus: () => events.push('clear'),
        })
        run.dependencies.print = () => events.push('print')
        await runBenchmarkCommand([], run.dependencies)
        expect(run.progress).toEqual(['! photo-transfer'])
        expect(events.some(event => /status Benchmarking ILCE-7M5 \(054c:0e78\) · 3 checks/.test(event))).toBe(true)
        expect(events[events.indexOf('print') - 1]).toBe('clear')
    })

    it('takes the camera from DARKGRADE_CAMERA and rejects a value that is not a USB id', async () => {
        vi.stubEnv('DARKGRADE_CAMERA', '04cb:0305')
        const run = benchmarkHarness([sony, fujifilm], {})
        await runBenchmarkCommand([], run.dependencies)
        expect(run.created).toEqual([{ vendorId: 0x04cb, productId: 0x0305 }])
        const explicit = benchmarkHarness([sony, fujifilm], {})
        await runBenchmarkCommand(['--camera', '054c:0e78'], explicit.dependencies)
        expect(explicit.created).toEqual([{ vendorId: 0x054c, productId: 0x0e78 }])
        vi.stubEnv('DARKGRADE_CAMERA', 'sony')
        await expect(runBenchmarkCommand([], run.dependencies)).rejects.toThrow(/DARKGRADE_CAMERA/)
        vi.unstubAllEnvs()
    })
})

describe('cameras and doctor', () => {
    const discovery = (ready: DiscoveredCamera[], otherModes: DiscoveredCamera[] = []) => ({
        discover: async () => ready,
        camerasInOtherModes: async () => otherModes,
    })

    it('lists each camera once with its state and reports only identity fields', async () => {
        const raw = { ...fujifilm, configurations: [{ secret: true }] } as DiscoveredCamera
        expect(await attachedCameras(discovery([sony], [sony, raw]))).toEqual([
            { ...sony, state: 'ready' },
            { ...fujifilm, state: 'other-mode' },
        ])
        const piped = streams({ terminal: false })
        expect(await runCamerasCommand({ json: false }, createTerminal(flags, piped.value), discovery([sony]))).toBe(0)
        expect(piped.written.output).toBe('ILCE-7M5\t054c:0e78\tready\n')
        const json = streams({ terminal: false })
        await runCamerasCommand({ json: true }, createTerminal(flags, json.value), discovery([sony]))
        expect(JSON.parse(json.written.output).cameras).toEqual([
            { usbId: '054c:0e78', vendor: 'Sony Group Corporation', ...sony, state: 'ready' },
        ])
    })

    it('fails on an old Node or a driver that will not load, and only warns when no camera is attached', async () => {
        const environment = {
            nodeVersion: '22.18.0',
            platform: 'darwin',
            architecture: 'arm64',
            cameraDiscovery: async () => discovery([sony]),
        }
        vi.stubEnv('DARKGRADE_HOME', await import('node:fs').then(fs => fs.mkdtempSync('/tmp/darkgrade-doctor-')))
        expect((await doctorChecks(environment)).map(check => check.outcome)).toEqual([
            'passed',
            'passed',
            'passed',
            'passed',
        ])
        expect((await doctorChecks({ ...environment, nodeVersion: '20.11.0' }))[0]).toMatchObject({ outcome: 'failed' })
        const unplugged = await doctorChecks({ ...environment, cameraDiscovery: async () => discovery([]) })
        expect(unplugged[unplugged.length - 1]).toMatchObject({ name: 'camera', outcome: 'warning' })
        const broken = await doctorChecks({
            ...environment,
            cameraDiscovery: async () => {
                throw new Error('No native build was found')
            },
        })
        expect(broken[broken.length - 1]).toMatchObject({ name: 'usb-driver', outcome: 'failed' })
        vi.unstubAllEnvs()
    })
})
