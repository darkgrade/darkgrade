import {
    parseBenchmarkArguments,
    runBenchmarkCommand,
    selectBenchmarkCamera,
    type BenchmarkCommandDependencies,
    type DiscoveredCamera,
} from '@cli/benchmark'
import type { Camera } from '@camera/index'
import type { runBenchmark } from '@workflows/telemetry-benchmark'
import { describe, expect, it } from 'vitest'

const sony: DiscoveredCamera = { vendorId: 0x054c, productId: 0x0e78, model: 'ILCE-7M5' }
const fujifilm: DiscoveredCamera = { vendorId: 0x04cb, productId: 0x0305, model: 'X100VI' }
const phone: DiscoveredCamera = { vendorId: 0x18d1, productId: 0x4ee1, model: 'Pixel' }

describe('benchmark arguments', () => {
    it('runs everything by default and keeps the old flags', () => {
        expect(parseBenchmarkArguments([])).toEqual({ capture: true, live: true, json: false })
        expect(parseBenchmarkArguments(['--camera', '054C:0E78', '--capture', '--live'])).toEqual({
            camera: { vendorId: 0x054c, productId: 0x0e78 },
            capture: true,
            live: true,
            json: false,
        })
        expect(parseBenchmarkArguments(['--no-capture', '--no-live', '--json'])).toMatchObject({
            capture: false,
            live: false,
            json: true,
        })
        for (const invalid of [['--camera'], ['--camera', 'sony'], ['--unknown'], ['--camera', '054c:0e78', '--camera', '054c:0e78']])
            expect(() => parseBenchmarkArguments(invalid)).toThrow(/benchmark/)
    })
})

describe('camera selection', () => {
    it('uses one camera, explains how to connect none, and asks when several are attached', () => {
        expect(selectBenchmarkCamera([fujifilm])).toEqual({ device: fujifilm })
        const none = selectBenchmarkCamera([], [{ ...fujifilm, model: undefined }])
        expect('message' in none && none.message).toMatch(/No camera found/)
        expect('message' in none && none.message).toMatch(/Fujifilm Corporation \(04cb:0305\) is attached but not in PTP mode/)
        expect('message' in none && none.message).toMatch(/PC Remote/)
        expect(selectBenchmarkCamera([phone, sony])).toEqual({ device: sony })
        const several = selectBenchmarkCamera([sony, fujifilm])
        expect('message' in several && several.message).toMatch(/--camera 054c:0e78.*ILCE-7M5/)
        expect('message' in several && several.message).toMatch(/--camera 04cb:0305.*X100VI/)
    })
})

function harness(devices: DiscoveredCamera[], passed = true) {
    const printed: string[] = [],
        progress: string[] = [],
        created: DiscoveredCamera[] = [],
        options: unknown[] = []
    let disconnected = 0
    const camera = {
        connect: async () => undefined,
        disconnect: async () => {
            disconnected++
        },
    } as unknown as Camera
    const result = {
        passed,
        checks: [
            { name: 'identity', passed: true, durationMilliseconds: 1 },
            { name: 'property-0x5001', passed: true, durationMilliseconds: 1 },
            { name: 'property-0xd001', passed: false, durationMilliseconds: 1, error: 'operation-failed' },
            { name: 'photo-transfer', passed, durationMilliseconds: 1, ...(!passed && { error: 'operation-failed' }) },
            { name: 'live-transfer', passed: true, durationMilliseconds: 1 },
        ],
        profile: { id: 'id', identity: { manufacturer: 'FUJIFILM', model: 'X100VI', firmware: '1.10' }, status: passed ? 'complete' : 'partial' },
    }
    const dependencies: BenchmarkCommandDependencies = {
        discover: async () => devices,
        camerasInOtherModes: async () => [],
        createCamera: async device => {
            created.push(device)
            return camera
        },
        runBenchmark: (async (_camera: Camera, benchmarkOptions: unknown) => {
            options.push(benchmarkOptions)
            await (benchmarkOptions as { flushEvidence: () => Promise<unknown> }).flushEvidence()
            return result
        }) as unknown as typeof runBenchmark,
        saveProfile: () => '/home/me/.darkgrade/profiles/id.json',
        flush: async () => (printed.length ? 'empty' : 'sent'),
        print: line => printed.push(line),
        progress: line => progress.push(line),
    }
    return { dependencies, printed, progress, created, options, disconnected: () => disconnected }
}

describe('benchmark command', () => {
    it('auto-detects the attached camera and prints a short summary', async () => {
        const run = harness([fujifilm])
        expect(await runBenchmarkCommand([], run.dependencies)).toBe(0)
        expect(run.created).toEqual([fujifilm])
        expect(run.options[0]).toMatchObject({ photo: true, liveView: true })
        expect(run.printed[0]).toContain('FUJIFILM X100VI, firmware 1.10')
        expect(run.printed[0]).toContain('Properties read: 1/2')
        expect(run.printed[0]).toContain('Photo capture:   ok')
        expect(run.printed[0]).toContain('/home/me/.darkgrade/profiles/id.json')
        expect(run.printed[0]).toContain('Telemetry:       uploaded')
        expect(run.disconnected()).toBe(1)
    })

    it('exits non-zero without opening anything when no camera or several are attached', async () => {
        for (const devices of [[], [sony, fujifilm]]) {
            const run = harness(devices)
            expect(await runBenchmarkCommand([], run.dependencies)).toBe(1)
            expect(run.created).toEqual([])
            expect(run.progress.join('\n')).toMatch(devices.length ? /Several cameras/ : /No camera found/)
        }
    })

    it('honours --camera, --no-capture and --json, and reports failures', async () => {
        const run = harness([sony, fujifilm], false)
        expect(await runBenchmarkCommand(['--camera', '04cb:0305', '--no-capture', '--json'], run.dependencies)).toBe(1)
        expect(run.created).toEqual([{ vendorId: 0x04cb, productId: 0x0305 }])
        expect(run.options[0]).toMatchObject({ photo: false, liveView: true })
        expect(JSON.parse(run.printed[0])).toMatchObject({ passed: false, profilePath: '/home/me/.darkgrade/profiles/id.json' })
    })
})
