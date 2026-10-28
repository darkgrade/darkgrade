import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { baseCodecs } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import {
    CAPABILITIES,
    evaluateCapabilities,
    simulateCamera,
    simulateCameraOverPtpIp,
    type SimulatedCamera,
} from '@scripts/camera-profiles/camera-capabilities'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** Protocol mechanics scenarios, never device evidence or matrix inputs. */
function scenario(overrides: Partial<CameraProfile> = {}): CameraProfile {
    return {
        schemaVersion: 1,
        id: 'capability-regression',
        manufacturer: 'Fixture',
        line: 'Fixture',
        model: 'Fixture',
        provenance: {
            fidelity: 'captured',
            sources: [{ location: 'tests/camera-simulation/capability-evidence-regressions.test.ts' }],
        },
        deviceInfo: {
            manufacturer: 'Fixture',
            model: 'Fixture',
            listsComplete: true,
            source: 0,
            operationsSupported: ['0x1001', '0x1002', '0x1003', '0x1004', '0x100e', '0x1014', '0x1015', '0x1016'],
            eventsSupported: ['0x4006'],
            devicePropertiesSupported: ['0x5001', '0x5011'],
        },
        properties: [
            {
                code: '0x5001',
                access: 'get',
                descriptor: { dataType: '0x0002', writable: false, factoryDefault: 100, current: 100 },
                source: 0,
            },
            {
                code: '0x5011',
                access: 'get-set',
                descriptor: {
                    dataType: '0xffff',
                    writable: true,
                    factoryDefault: '20260101T000000',
                    current: '20260101T000000',
                    form: { enumeration: ['20260101T000000', '20260201T000000'] },
                },
                source: 0,
            },
        ],
        exchanges: [{ operation: '0x100e', parameters: ['0x0', '0x0'], response: { code: '0x2005' }, source: 0 }],
        events: [],
        quirks: [],
        ...overrides,
    }
}

const capability = (id: string) => CAPABILITIES.find(candidate => candidate.id === id)!
async function connected(profile: CameraProfile) {
    const target = simulateCamera(profile)
    await target.camera.connect()
    return target
}
async function close(target: SimulatedCamera) {
    await target.camera.disconnect().catch(() => undefined)
}
afterEach(() => {
    vi.useRealTimers()
})

describe('capability evidence boundaries', () => {
    it('keeps simulator factories from replacing the console or adding process-wide exit handlers', async () => {
        const consoleBefore = [console.log, console.error, console.warn, console.info]
        const listenersBefore = [
            process.listenerCount('uncaughtException'),
            process.listenerCount('unhandledRejection'),
        ]
        const usb = simulateCamera(scenario())
        const network = await simulateCameraOverPtpIp(scenario())
        try {
            expect([console.log, console.error, console.warn, console.info]).toEqual(consoleBefore)
            expect([process.listenerCount('uncaughtException'), process.listenerCount('unhandledRejection')]).toEqual(
                listenersBefore
            )
        } finally {
            await close(usb)
            await network.stop()
        }
    })
    it('reports failed sessions when OpenSession refuses the request, including a failed retry', async () => {
        for (const codes of [['0x200f'], ['0x201e', '0x200f']]) {
            const target = simulateCamera(
                scenario({ exchanges: codes.map(code => ({ operation: '0x1002', response: { code }, source: 0 })) })
            )
            const results = await evaluateCapabilities(target)
            expect(results.session).toMatchObject({
                status: 'fail',
                detail: expect.stringContaining('OpenSession returned'),
            })
            await close(target)
        }
    })

    it('does not turn an empty property list into a successful property test', async () => {
        const profile = scenario()
        profile.deviceInfo!.devicePropertiesSupported = []
        profile.properties = []
        const target = await connected(profile)
        try {
            await expect(capability('list-properties').run(target)).rejects.toThrow('no advertised property list')
        } finally {
            await close(target)
        }
    })

    it('surfaces descriptor decode failures rather than accepting a shortened property list', async () => {
        const profile = scenario()
        profile.deviceInfo!.devicePropertiesSupported = ['0x5005']
        profile.properties = [
            {
                code: '0x5005',
                descriptor: { dataType: '0x0002', writable: false, factoryDefault: 2, current: 1 },
                source: 0,
            },
        ]
        const target = await connected(profile)
        try {
            await expect(capability('list-properties').run(target)).rejects.toThrow('decoded 0/1')
        } finally {
            await close(target)
        }
    })

    it('restores the original setting even when changed-value readback fails', async () => {
        const target = await connected(scenario())
        vi.spyOn(target.camera, 'get').mockResolvedValueOnce('wrong readback' as never)
        try {
            await expect(capability('set-property').run(target)).rejects.toThrow('wrong readback')
            expect(await target.camera.get(genericPropertyRegistry.DateTime)).toBe('20260101T000000')
        } finally {
            await close(target)
        }
    })

    it('throws on a rejected high-level property write', async () => {
        const profile = scenario()
        profile.exchanges.push({ operation: '0x1016', parameters: ['0x5011'], response: { code: '0x200f' }, source: 0 })
        const target = await connected(profile)
        try {
            await expect(target.camera.set(genericPropertyRegistry.DateTime, '20260201T000000')).rejects.toThrow(
                'SetDevicePropValue returned 0x200f'
            )
        } finally {
            await close(target)
        }
    })

    it('keeps command acceptance separate from a completed capture with image media', async () => {
        const profile = scenario()
        profile.exchanges[0].response.code = '0x2001'
        const target = await connected(profile)
        try {
            await expect(capability('capture').run(target)).rejects.toThrow('without returned image media')
        } finally {
            await close(target)
        }
    })

    it('rejects a marker-only preview instead of calling four bytes an image frame', async () => {
        const target = await connected(scenario())
        vi.spyOn(target.camera, 'captureLiveView').mockResolvedValue({ data: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9) })
        try {
            await expect(capability('live-view').run(target)).rejects.toThrow('no complete frame dimensions')
        } finally {
            await close(target)
        }
    })

    it('releases the transport even when CloseSession is refused', async () => {
        const profile = scenario()
        profile.exchanges.push({ operation: '0x1003', parameters: [], response: { code: '0x2019' }, source: 0 })
        const target = await connected(profile)
        await expect(target.camera.disconnect()).rejects.toThrow('CloseSession returned 0x2019')
        expect(target.camera.getInstance().transport.isConnected()).toBe(false)
    })

    it('does not pass an entire exchange suite when only one operation is expressible', async () => {
        const target = simulateCamera(
            scenario({
                exchanges: [
                    { operation: '0x1002', parameters: ['0x1'], response: { code: '0x2001' }, source: 0 },
                    { operation: '0x9001', parameters: [], response: { code: '0x2001' }, source: 0 },
                ],
            })
        )
        const results = await evaluateCapabilities(target)
        expect(results['recorded-exchanges']).toMatchObject({
            status: 'unsupported',
            detail: expect.stringContaining('1/2 replayed'),
        })
        await close(target)
    })

    it('compares replayed data instead of accepting a matching response code with corrupted payload', async () => {
        const target = await connected(
            scenario({
                exchanges: [
                    {
                        operation: '0x1004',
                        parameters: [],
                        response: { code: '0x2001', data: '010000002a000000' },
                        source: 0,
                    },
                ],
            })
        )
        const transport = target.camera.getInstance().transport
        const receive = transport.receive.bind(transport)
        vi.spyOn(transport, 'receive').mockImplementation(async (...argumentsList) => {
            const bytes = await receive(...argumentsList)
            if (new DataView(bytes.buffer, bytes.byteOffset).getUint16(4, true) === 2) bytes[16] = 43
            return bytes
        })
        try {
            await expect(capability('recorded-exchanges').run(target)).rejects.toThrow('response data differs')
        } finally {
            await close(target)
        }
    })

    it('marks response parameter tuples unavailable when the library does not expose them', async () => {
        const target = await connected(
            scenario({
                exchanges: [
                    {
                        operation: '0x1006',
                        parameters: ['0xffffffff', '0x0', '0x0'],
                        response: { code: '0x2001', parameters: ['0x2'] },
                        source: 0,
                    },
                ],
            })
        )
        try {
            await expect(capability('recorded-exchanges').run(target)).rejects.toThrow('parameters not expressible')
        } finally {
            await close(target)
        }
    })

    it('keeps a missing initial session prerequisite separate from a genuine session loss after OpenSession', async () => {
        const property = { operation: '0x1014', parameters: ['0x5011'], response: { code: '0x200a' }, source: 0 }
        const missing = await connected(scenario({ exchanges: [property] }))
        try {
            await expect(capability('recorded-exchanges').run(missing)).rejects.toThrow(
                'missing session or quirk prerequisites'
            )
        } finally {
            await close(missing)
        }
        const established = await connected(
            scenario({
                exchanges: [
                    { operation: '0x1002', parameters: ['0x1'], response: { code: '0x2001' }, source: 0 },
                    property,
                ],
            })
        )
        const transport = established.camera.getInstance().transport
        const receive = transport.receive.bind(transport)
        vi.spyOn(transport, 'receive').mockImplementation(async (...argumentsList) => {
            const bytes = await receive(...argumentsList)
            const view = new DataView(bytes.buffer, bytes.byteOffset)
            if (view.getUint16(4, true) === 3 && view.getUint16(6, true) === 0x200a) view.setUint16(6, 0x2003, true)
            return bytes
        })
        try {
            await expect(capability('recorded-exchanges').run(established)).rejects.toThrow(
                'mismatch: 0x2003 != 0x200a'
            )
        } finally {
            await close(established)
        }
    })

    it('removes the event listener and timer when the triggering exchange cannot run', async () => {
        vi.useFakeTimers()
        const target = await connected(
            scenario({
                exchanges: [{ operation: '0x9001', parameters: [], response: { code: '0x2001' }, source: 0 }],
                events: [{ code: '0x4006', parameters: ['0x5001'], afterOperation: '0x9001', source: 0 }],
            })
        )
        const off = vi.spyOn(target.camera, 'off')
        const timersBefore = vi.getTimerCount()
        try {
            await expect(capability('events').run(target)).rejects.toThrow('could not replay')
            expect(off).toHaveBeenCalledTimes(1)
            expect(vi.getTimerCount()).toBe(timersBefore)
        } finally {
            await close(target)
        }
    })

    it('stops the suite after a timeout without starting another camera operation', async () => {
        const target = simulateCamera(scenario())
        target.timeoutMilliseconds = 5
        let finish: () => void = () => undefined
        vi.spyOn(target.camera, 'connect').mockImplementation(
            () =>
                new Promise<void>(resolve => {
                    finish = resolve
                })
        )
        const send = vi.spyOn(target.camera, 'send')
        const results = await evaluateCapabilities(target)
        expect(results.session.status).toBe('fail')
        expect(
            Object.values(results)
                .slice(1)
                .every(result => result.status === 'no-data')
        ).toBe(true)
        expect(send).not.toHaveBeenCalled()
        finish()
        await close(target)
    })

    it('pads narrow codecs into full 32-bit PTP command parameter slots', async () => {
        const profile = scenario({
            exchanges: [{ operation: '0x9001', parameters: ['0x1234'], response: { code: '0x2001' }, source: 0 }],
        })
        const target = await connected(profile)
        const command: OperationDefinition = {
            code: 0x9001,
            name: 'NarrowParameterScenario',
            description: 'PTP slot mechanics',
            dataDirection: 'none',
            operationParameters: [{ name: 'Value', description: 'Value', codec: baseCodecs.uint16, required: true }],
            responseParameters: [],
        }
        const sent = vi.spyOn(target.camera.getInstance().transport, 'send')
        try {
            expect((await target.camera.send(command, { Value: 0x1234 })).code).toBe(0x2001)
            const bytes = sent.mock.calls[0][0]
            expect(bytes.length).toBe(16)
            expect(Array.from(bytes.slice(12))).toEqual([0x34, 0x12, 0, 0])
        } finally {
            await close(target)
        }
    })

    it.each([
        ['0x2001', ''],
        ['0x2019', undefined],
    ])('rejects a zero-progress or failed generic object chunk: %s', async (code, data) => {
        const target = await connected(
            scenario({
                exchanges: [
                    {
                        operation: '0x101b',
                        parameters: ['0x1', '0x0', '0x4'],
                        response: { code, ...(data === undefined ? {} : { data }) },
                        source: 0,
                    },
                ],
            })
        )
        try {
            await expect(target.camera.getInstance().getObject(1, 4)).rejects.toThrow(
                code === '0x2001' ? 'empty or oversized chunk' : 'GetPartialObject returned 0x2019'
            )
        } finally {
            await close(target)
        }
    })

    it('rejects a generic chunk larger than the requested remainder', async () => {
        const target = await connected(scenario())
        vi.spyOn(target.camera.getInstance(), 'send').mockResolvedValue({
            code: 0x2001,
            data: new Uint8Array(5),
        } as never)
        try {
            await expect(target.camera.getInstance().getObject(1, 4)).rejects.toThrow('empty or oversized chunk')
        } finally {
            await close(target)
        }
    })

    it.each([NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1])(
        'rejects invalid generic object size %s before any transfer',
        async size => {
            const target = await connected(scenario())
            const send = vi.spyOn(target.camera.getInstance(), 'send')
            try {
                await expect(target.camera.getInstance().getObject(1, size)).rejects.toThrow('nonnegative safe integer')
                expect(send).not.toHaveBeenCalled()
            } finally {
                await close(target)
            }
        }
    )
})
