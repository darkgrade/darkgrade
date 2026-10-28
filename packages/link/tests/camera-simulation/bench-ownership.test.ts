import {
    assertBenchAvailable,
    assertNoActiveCardTake,
    benchTool,
    type BenchStatus,
} from '@scripts/camera-lab/bench-ownership'
import { loadRegistry } from '@scripts/camera-lab/camera-registry'
import { afterEach, describe, expect, it, vi } from 'vitest'

const camera = loadRegistry().cameras.find(camera => camera.id === 'canon-eos-80d')!
const available = (): BenchStatus => ({
    hostname: camera.host!,
    jobs: [],
    recoveries: [],
    hardwareOwners: [],
    cameras: [
        {
            label: camera.benchLabel!,
            usbMatch: `${camera.usb!.vendorId}:${camera.usb!.productId}`.replaceAll('0x', ''),
            health: { status: 'ready', usbPresent: true },
            transport: { mode: 'usb' },
            plug: { output: true },
        },
    ],
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('hardware lab bench ownership boundary', () => {
    it('refuses persistent recording state even after its original job lease has disappeared', () => {
        for (const state of ['recording', 'stopping', 'uncertain', 'starting']) {
            expect(() =>
                assertNoActiveCardTake({ cameras: [{ camera: camera.benchLabel!, state }] }, camera.benchLabel!)
            ).toThrow(/recording/)
        }
        expect(() =>
            assertNoActiveCardTake({ cameras: [{ camera: 'another-camera', state: 'recording' }] }, camera.benchLabel!)
        ).not.toThrow()
        expect(() => assertNoActiveCardTake(undefined, camera.benchLabel!)).not.toThrow()
    })
    it('refuses recording jobs, recovery and another controller owner without opening hardware', () => {
        for (const mutate of [
            (status: BenchStatus) => status.jobs.push({ cameraLabel: camera.benchLabel! }),
            (status: BenchStatus) => status.jobs.push({}),
            (status: BenchStatus) => status.recoveries.push({ cameraLabel: camera.benchLabel!, status: 'running' }),
            (status: BenchStatus) =>
                status.hardwareOwners!.push({
                    resource: `camera:${camera.benchLabel}`,
                    owner: 'other',
                    expiresAt: Date.now() + 60_000,
                }),
        ]) {
            const status = available()
            mutate(status)
            expect(() => assertBenchAvailable(status, camera)).toThrow()
        }
    })

    it('preserves powered-off cameras and rejects stale host or USB mappings', () => {
        const poweredOff = available()
        poweredOff.cameras[0].plug!.output = false
        expect(() => assertBenchAvailable(poweredOff, camera)).toThrow(/powered off/)
        const moved = available()
        moved.cameras[0].usbMatch = '04a9:ffff'
        expect(() => assertBenchAvailable(moved, camera)).toThrow(/mapping/)
        const wrongHost = available()
        wrongHost.hostname = 'other-bench'
        expect(() => assertBenchAvailable(wrongHost, camera)).toThrow(/host/)
    })

    it('requires the newly claimed owner to be visible through the running MCP service', () => {
        const status = available()
        expect(() => assertBenchAvailable(status, camera, 'mine')).toThrow(/cannot see/)
        status.hardwareOwners!.push({
            resource: `camera:${camera.benchLabel}`,
            owner: 'mine',
            expiresAt: Date.now() + 60_000,
        })
        expect(() => assertBenchAvailable(status, camera, 'mine')).not.toThrow()
        status.hardwareOwners![0].expiresAt = 0
        expect(() => assertBenchAvailable(status, camera, 'mine')).toThrow(/cannot see/)
    })

    it('reads the deployed stateless MCP SSE response and refuses MCP errors', async () => {
        const fetch = vi
            .fn()
            .mockResolvedValue(
                new Response(
                    `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(available()) }] } })}\n\n`
                )
            )
        vi.stubGlobal('fetch', fetch)
        expect(await benchTool('bench_status', {})).toMatchObject({ hostname: camera.host })
        expect(JSON.parse(fetch.mock.calls[0][1].body).params.name).toBe('bench_status')
        fetch.mockResolvedValue(new Response(JSON.stringify({ id: 1, result: { isError: true } })))
        await expect(benchTool('agent_job_start', {})).rejects.toThrow(/failed/)
    })
})
