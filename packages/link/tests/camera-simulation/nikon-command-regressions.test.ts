import { NikonCamera } from '@camera/nikon-camera'
import { simulateCamera } from '@scripts/camera-profiles/camera-capabilities'
import { formatBytes, type CameraProfile, type RecordedExchange } from '@transport/simulated/camera-profile'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Mechanics only: bounded Nikon status/recording responses, not hardware support evidence. */
function descriptor(code: number, value: number, dataType = 0x0002): string {
    const width = dataType === 0x0002 ? 1 : 4
    const bytes = new Uint8Array(4 + 2 + 1 + width * 2 + 1)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, code, true)
    view.setUint16(4, dataType, true)
    if (width === 1) bytes[7 + width] = value
    else view.setUint32(7 + width, value, true)
    return formatBytes(bytes)
}
function exchange(operation: string, parameters: string[] = [], code = '0x2001', data?: string): RecordedExchange {
    return { operation, parameters, response: { code, ...(data === undefined ? {} : { data }) }, source: 0 }
}
function scenario(condition = 0, selector = 1): CameraProfile {
    return {
        schemaVersion: 1,
        id: 'nikon-command-regression',
        manufacturer: 'Nikon',
        line: 'Mechanics fixture',
        model: 'Fixture',
        usb: { vendorId: '0x04b0', productIds: ['0xffff'] },
        provenance: {
            fidelity: 'captured',
            sources: [{ location: 'tests/camera-simulation/nikon-command-regressions.test.ts' }],
        },
        deviceInfo: {
            manufacturer: 'Nikon',
            model: 'Fixture',
            listsComplete: true,
            operationsSupported: [
                '0x1001',
                '0x1002',
                '0x1003',
                '0x100e',
                '0x90c2',
                '0x90c8',
                '0x9201',
                '0x9202',
                '0x920a',
                '0x920b',
                '0x9431',
                '0x9435',
                '0x943a',
                '0x943c',
            ],
            eventsSupported: [],
            devicePropertiesSupported: [],
            source: 0,
        },
        properties: [],
        events: [],
        quirks: [],
        exchanges: [
            exchange('0x943a', ['0xd1b8'], '0x2001', descriptor(0xd1b8, 1)),
            exchange('0x943a', ['0xd1a6'], '0x2001', descriptor(0xd1a6, selector)),
            exchange('0x943a', ['0xd0a4'], '0x2001', descriptor(0xd0a4, condition, 0x0006)),
            exchange('0x90c8'),
            exchange('0x9435', ['0x1']),
            exchange('0x9435', ['0x0']),
            exchange('0x9201'),
            exchange('0x9202'),
            exchange('0x920a'),
            exchange('0x920b'),
        ],
    }
}
async function connected(profile = scenario()) {
    const target = simulateCamera(profile)
    await target.camera.connect()
    return { target, camera: target.camera.getInstance() as NikonCamera }
}
afterEach(() => {
    vi.useRealTimers()
})

describe('Nikon command and media boundaries', () => {
    it('fires the shutter with the default capture options and claims no media it did not retrieve', async () => {
        const profile = scenario()
        profile.exchanges.push(
            exchange('0x90c2', ['0x1']),
            exchange('0x90c2', ['0x0']),
            { ...exchange('0x943c', ['0xd1a6']), dataFromHost: '00' },
            { ...exchange('0x943c', ['0xd1a6']), dataFromHost: '01' },
            exchange('0x100e', ['0x0', '0x0'])
        )
        const { target, camera } = await connected(profile)
        const send = vi.spyOn(camera, 'send')
        try {
            // The public Camera API asks for info and data by default; the shutter still fires.
            await expect(target.camera.captureImage()).resolves.toEqual({ info: undefined, data: undefined })
            expect(send.mock.calls.filter(([operation]) => operation.code === 0x100e)).toHaveLength(1)
        } finally {
            await target.camera.disconnect()
        }
    })

    it('surfaces a rejected command-only shutter instead of returning an empty success', async () => {
        const profile = scenario(0, 0)
        profile.exchanges.push(exchange('0x100e', ['0x0', '0x0'], '0x2019'))
        const { target, camera } = await connected(profile)
        try {
            await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow(
                'InitiateCapture returned 0x2019'
            )
        } finally {
            await target.camera.disconnect()
        }
    })

    it.each(['0x2001', '0x2019'])(
        'restores the video selector and PC camera mode after photo release %s',
        async code => {
            const profile = scenario()
            profile.exchanges.push(
                exchange('0x90c2', ['0x1']),
                exchange('0x90c2', ['0x0']),
                { ...exchange('0x943c', ['0xd1a6']), dataFromHost: '00' },
                { ...exchange('0x943c', ['0xd1a6']), dataFromHost: '01' },
                exchange('0x100e', ['0x0', '0x0'], code)
            )
            const { target, camera } = await connected(profile)
            const send = vi.spyOn(camera, 'send')
            try {
                const outcome = camera.captureImage({ includeInfo: false, includeData: false })
                if (code === '0x2001') await expect(outcome).resolves.toEqual({ info: undefined, data: undefined })
                else await expect(outcome).rejects.toThrow('InitiateCapture returned 0x2019')
                const selectors = send.mock.calls
                    .filter(([operation]) => operation.code === 0x943c)
                    .map(([, , data]) => Array.from(data!))
                expect(selectors).toEqual([[0], [1]])
                expect(
                    send.mock.calls.some(
                        ([operation, parameters]) =>
                            operation.code === 0x90c2 && (parameters as { Mode: string }).Mode === 'PC_CAMERA'
                    )
                ).toBe(true)
            } finally {
                await target.camera.disconnect()
            }
        }
    )

    it('force-restores VIDEO after PHOTO was accepted but its readiness check failed', async () => {
        const profile = scenario()
        profile.exchanges = profile.exchanges.filter(item => item.operation !== '0x90c8')
        profile.exchanges.push(
            ...['0x2001', '0x2001', '0x2001', '0xa004', '0x2001'].map(code => exchange('0x90c8', [], code)),
            exchange('0x90c2', ['0x1']),
            exchange('0x90c2', ['0x0']),
            { ...exchange('0x943c', ['0xd1a6']), dataFromHost: '00' },
            { ...exchange('0x943c', ['0xd1a6']), dataFromHost: '01' }
        )
        const { target, camera } = await connected(profile)
        const send = vi.spyOn(camera, 'send')
        try {
            await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow(
                'DeviceReady returned 0xa004'
            )
            expect(
                send.mock.calls
                    .filter(([operation]) => operation.code === 0x943c)
                    .map(([, , data]) => Array.from(data!))
            ).toEqual([[0], [1]])
            expect(
                send.mock.calls.some(
                    ([operation, parameters]) =>
                        operation.code === 0x90c2 && (parameters as { Mode: string }).Mode === 'PC_CAMERA'
                )
            ).toBe(true)
            expect(send.mock.calls.some(([operation]) => operation.code === 0x100e)).toBe(false)
        } finally {
            await target.camera.disconnect()
        }
    })

    it('does not send a movie start command when the camera reports a recording prohibition', async () => {
        const { target, camera } = await connected(scenario(1))
        const send = vi.spyOn(camera, 'send')
        try {
            await expect(camera.startRecording()).rejects.toThrow('noCardInserted')
            expect(send.mock.calls.some(([operation]) => operation.code === 0x920a)).toBe(false)
        } finally {
            await target.camera.disconnect()
        }
    })

    it('sends an allowed movie command after application-mode setup without claiming a recorded file', async () => {
        const { target, camera } = await connected()
        const send = vi.spyOn(camera, 'send')
        try {
            await expect(camera.startRecording()).resolves.toBeUndefined()
            const operations = send.mock.calls.map(([operation]) => operation.code)
            expect(operations.indexOf(0x9435)).toBeLessThan(operations.indexOf(0x920a))
            expect(operations.at(-1)).toBe(0x920a)
        } finally {
            await target.camera.disconnect()
        }
    })

    it('closes the PTP session and transport when live-view teardown fails', async () => {
        const profile = scenario()
        profile.exchanges.find(item => item.operation === '0x9202')!.response.code = '0xa004'
        const { target, camera } = await connected(profile)
        await camera.startRecording()
        await expect(target.camera.disconnect()).rejects.toThrow('Nikon EndLiveView failed')
        expect(camera.transport.isConnected()).toBe(false)
    })

    it.each(['0x2019', '0xa004'])(
        'rejects movie start refusal %s instead of claiming recording started',
        async code => {
            const profile = scenario()
            profile.exchanges.find(item => item.operation === '0x920a')!.response.code = code
            const { target, camera } = await connected(profile)
            try {
                await expect(camera.startRecording()).rejects.toThrow(`StartMovieRecord returned ${code}`)
            } finally {
                await target.camera.disconnect()
            }
        }
    )

    it('does not tear down live view after the stop-recording command is refused', async () => {
        const profile = scenario()
        profile.exchanges.find(item => item.operation === '0x920b')!.response.code = '0xa004'
        const { target, camera } = await connected(profile)
        const send = vi.spyOn(camera, 'send')
        try {
            await expect(camera.stopRecording()).rejects.toThrow('EndMovieRecord returned 0xa004')
            expect(send.mock.calls.map(([operation]) => operation.code)).toEqual([0x920b])
        } finally {
            await target.camera.disconnect()
        }
    })

    it('fails an unsupported DeviceReady immediately instead of polling forever', async () => {
        const profile = scenario()
        profile.exchanges.find(item => item.operation === '0x90c8')!.response.code = '0x2005'
        const { target, camera } = await connected(profile)
        try {
            await expect(camera.startRecording()).rejects.toThrow('DeviceReady returned 0x2005')
        } finally {
            await target.camera.disconnect()
        }
    })

    it('bounds an image-buffer busy condition and never sends StartMovieRecord', async () => {
        vi.useFakeTimers()
        const { target, camera } = await connected(scenario(1 << 9))
        const send = vi.spyOn(camera, 'send')
        const outcome = camera.startRecording().then(
            () => undefined,
            error => error
        )
        await vi.advanceTimersByTimeAsync(15_010)
        expect(await outcome).toMatchObject({ message: 'Nikon image buffer remained busy after 15000 ms' })
        expect(send.mock.calls.some(([operation]) => operation.code === 0x920a)).toBe(false)
        await target.camera.disconnect()
    })

    it('bounds DeviceReady busy responses instead of running an unbounded readiness loop', async () => {
        vi.useFakeTimers()
        const profile = scenario()
        profile.exchanges.find(item => item.operation === '0x90c8')!.response.code = '0x2019'
        const { target, camera } = await connected(profile)
        const outcome = camera.startRecording().then(
            () => undefined,
            error => error
        )
        await vi.advanceTimersByTimeAsync(15_010)
        expect(await outcome).toMatchObject({ message: 'Nikon DeviceReady remained busy after 15000 ms' })
        await target.camera.disconnect()
    })

    it('rejects zero-progress and failed object chunks instead of looping on them', async () => {
        for (const [code, data] of [
            ['0x2001', ''],
            ['0x2019', undefined],
        ]) {
            const profile = scenario()
            profile.exchanges.push(exchange('0x9431', ['0x1', '0x0', '0x0', '0x4', '0x0'], code, data))
            const { target, camera } = await connected(profile)
            try {
                await expect(camera.getObject(1, 4)).rejects.toThrow(
                    code === '0x2001' ? 'empty or oversized chunk' : 'GetPartialObjectEx returned 0x2019'
                )
            } finally {
                await target.camera.disconnect()
            }
        }
    })

    it('rejects a Nikon property write that the camera refused', async () => {
        const profile = scenario()
        profile.exchanges.push(exchange('0x943c', ['0xd1a6'], '0x200f'))
        const { target, camera } = await connected(profile)
        try {
            await expect(camera.set(camera.registry.properties.LiveViewSelector, 'VIDEO')).rejects.toThrow(
                'SetDevicePropValueEx returned 0x200f'
            )
        } finally {
            await target.camera.disconnect()
        }
    })

    it('rejects a Nikon chunk larger than the requested remainder', async () => {
        const { target, camera } = await connected()
        vi.spyOn(camera, 'send').mockResolvedValue({ code: 0x2001, data: new Uint8Array(5) } as never)
        try {
            await expect(camera.getObject(1, 4)).rejects.toThrow('empty or oversized chunk')
        } finally {
            await target.camera.disconnect()
        }
    })

    it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid Nikon object size %s before any transfer',
        async size => {
            const { target, camera } = await connected()
            const send = vi.spyOn(camera, 'send')
            try {
                await expect(camera.getObject(1, size)).rejects.toThrow('nonnegative safe integer')
                expect(send).not.toHaveBeenCalled()
            } finally {
                await target.camera.disconnect()
            }
        }
    )
})
