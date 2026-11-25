import { SonyCamera } from '@vendors/sony/sony-camera'
import { Logger } from '@core/logger'
import type { SonyDevicePropDesc } from '@vendors/sony/datasets/sdi-ext-device-prop-info-dataset'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

function cameraFixture() {
    const transport = { isLittleEndian: () => true, isConnected: () => true } as unknown as TransportInterface
    const camera = new SonyCamera(transport, new Logger({ captureConsole: false, renderInTerminal: false }))
    const sent: string[] = []
    const replies: Array<{ code: number; data?: unknown }> = []
    camera.send = (async operation => {
        sent.push(operation.name)
        return replies.shift() ?? { code: 0x2001 }
    }) as typeof camera.send
    camera.set = vi.fn(async () => undefined)
    return { camera, sent, replies }
}

/** A full-inventory descriptor as the Sony dataset codec yields it. */
function descriptor(code: number, raw: number, decoded: unknown = raw, getSet = 'GET'): SonyDevicePropDesc {
    const fields = { currentValueRaw: raw, currentValueDecoded: decoded, vendorExtensions: { enabled: true }, getSet }
    return { devicePropertyCode: code, ...fields } as SonyDevicePropDesc
}

/** A live-view dataset whose four-byte JPEG starts at the declared offset 24. */
function liveViewFrame(): Uint8Array {
    const bytes = new Uint8Array(28)
    const header = new DataView(bytes.buffer)
    header.setUint32(0, 24, true)
    header.setUint32(4, 4, true)
    bytes.set([0xff, 0xd8, 0xff, 0xd9], 24)
    return bytes
}

describe('Sony incremental property boundaries', () => {
    it.each(['final-step', 'disabled', 'range-changed'] as const)('%s uses each fresh descriptor', async scenario => {
        const camera = new SonyCamera(
            { isLittleEndian: () => true } as unknown as TransportInterface,
            new Logger({ captureConsole: false, renderInTerminal: false })
        )
        let raw = 0,
            writes = 0
        vi.spyOn(camera, 'send').mockImplementation(async (operation, parameters, data) => {
            if (operation.code === 0x9209)
                return {
                    code: 0x2001,
                    data: {
                        properties: [
                            {
                                devicePropertyCode: 0x5010,
                                dataType: 3,
                                currentValueRaw: raw,
                                currentValueDecoded: `${raw / 1000}`,
                                sonyGetSetFlag: 0,
                                sonyEnabledFlag: scenario === 'disabled' && writes ? 0 : 1,
                                vendorExtensions: { enabled: scenario !== 'disabled' || writes === 0 },
                                getSet: 'GET',
                                minimumValue: 0,
                                maximumValue: scenario === 'range-changed' && writes ? 500 : 1000,
                                stepSize: 10,
                            },
                        ],
                    },
                } as any
            expect(operation.code).toBe(0x9207)
            expect(parameters).toMatchObject({ sdiControlCode: 0x5010 })
            expect(data).toEqual(Uint8Array.of(1))
            writes++
            raw += 10
            return { code: 0x2001 } as any
        })
        const action = camera.set(camera.registry.properties.ExposureCompensation, '+1 EV')
        if (scenario === 'final-step') {
            await expect(action).resolves.toBeUndefined()
            expect(writes).toBe(100)
            expect(raw).toBe(1000)
        } else {
            await expect(action).rejects.toThrow(scenario === 'disabled' ? 'disabled' : 'range')
            expect(writes).toBe(1)
        }
    })
})

describe('Sony session response validation', () => {
    it('reads the standard identity once per connection and stays connected when the body refuses or drops it', async () => {
        for (const refusal of ['response', 'throw'] as const) {
            const { camera, sent } = cameraFixture()
            const reply = camera.send
            camera.send = (async (operation, ...rest) => {
                if (operation.name !== 'GetDeviceInfo') return reply(operation, ...rest)
                sent.push(operation.name)
                if (refusal === 'throw') throw new Error('identity read timed out')
                return { code: 0x2005 }
            }) as typeof camera.send
            camera.refreshPropertyStates = async () => []
            await camera.connect()
            expect(sent.filter(name => name === 'GetDeviceInfo')).toHaveLength(1)
            expect(sent.indexOf('GetDeviceInfo')).toBe(sent.lastIndexOf('SDIO_Connect') + 1)
            expect(camera.set).toHaveBeenCalledTimes(2)
        }
    })

    it.each([
        ['AF_C_NOT_FOCUSED', /could not focus \(low contrast or too dark\)/],
        ['AF_C_TRACKING', /still tracking the subject/],
        ['UNLOCK', /last reported UNLOCK/],
    ] as const)('a focus timeout says what the body reported: %s', async (status, expected) => {
        const { camera } = cameraFixture()
        camera.get = (async () => status) as typeof camera.get
        await expect((camera as any).waitForFocus(120)).rejects.toThrow(expected)
        await expect((camera as any).waitForFocus(120)).rejects.toThrow(/did not report focus within 120 ms/)
        camera.get = (async () => 'AF_C_FOCUSED') as typeof camera.get
        await expect((camera as any).waitForFocus(120)).resolves.toBe('acquired')
    })

    it('preserves a refusal when an existing session cannot be closed', async () => {
        const { camera, replies, sent } = cameraFixture()
        replies.push({ code: 0x201e }, { code: 0x200f })
        await expect(camera.connect()).rejects.toMatchObject({ code: 0x200f })
        expect(sent).toEqual(['SDIO_OpenSession', 'CloseSession'])
    })

    it.each([1, 2, 4])('stops at failed handshake step %i', async failedStep => {
        const { camera, replies, sent } = cameraFixture()
        replies.push(...Array.from({ length: failedStep }, () => ({ code: 0x2001 })), { code: 0x200f })
        await expect(camera.connect()).rejects.toMatchObject({ code: 0x200f })
        expect(sent).toHaveLength(failedStep + 1)
        expect(camera.set).not.toHaveBeenCalled()
    })

})

describe('Sony authoritative property refresh', () => {
    it('stops remote image delivery before switching from capture to card enumeration', async () => {
        const { camera, replies, sent } = cameraFixture()
        Object.assign(camera, { liveViewPostViewEnabled: true })
        const property = camera.registry.properties.ContentTransferEnable
        replies.push({ code: 0x2001 }, { code: 0x2001, data: { properties: [descriptor(property.code, 1, 'ENABLE')] } })
        await camera.prepareStorageRead()
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.SetLiveViewEnable, 'DISABLE')
        expect(camera.set).toHaveBeenCalledWith(camera.registry.properties.SetPostViewEnable, 'DISABLE')
        expect(sent).toEqual(['SDIO_SetContentsTransferMode', 'SDIO_GetAllExtDevicePropInfo'])
    })

    it('retains the reserved Sony change-notification word and still accepts an empty legacy notification', () => {
        const { camera } = cameraFixture()
        const listener = vi.fn()
        camera.on(camera.registry.events.SDIE_DevicePropChanged, listener)
        ;(camera as any).handleEvent({ code: 0xc203, parameters: [0], transactionId: 1 })
        expect(listener).toHaveBeenLastCalledWith({ Reserved: 0 })
        ;(camera as any).handleEvent({ code: 0xc203, parameters: [], transactionId: 2 })
        expect(listener).toHaveBeenLastCalledWith({})
    })

    it('reads fresh values from bulk inventory without issuing an unadvertised individual read', async () => {
        const { camera, replies, sent } = cameraFixture()
        const property = camera.registry.properties.ContentTransferEnable
        Object.assign(camera, { contentTransferModeEnabled: true })
        replies.push({ code: 0x2001, data: { properties: [descriptor(property.code, 1, 'ENABLE')] } })
        expect(await camera.get(property)).toBe('ENABLE')
        expect(sent).toEqual(['SDIO_GetAllExtDevicePropInfo'])
        replies.push({ code: 0x2001, data: { properties: [] } })
        await expect(camera.get(property)).rejects.toThrow('not advertised')
    })

    it('removes controls absent from the next full inventory and retains the last valid inventory after a refusal', async () => {
        const { camera, replies } = cameraFixture()
        const property = descriptor(0xd309, 1, 1, 'GET_SET')
        replies.push({ code: 0x2001, data: { properties: [property] } })
        expect((await camera.refreshPropertyStates()).map(entry => entry.code)).toEqual([0xd309])
        replies.push({ code: 0x2019 })
        await expect(camera.refreshPropertyStates()).rejects.toMatchObject({ code: 0x2019 })
        expect(camera.listPropertyStates().map(entry => entry.code)).toEqual([0xd309])
        replies.push({ code: 0x2001, data: { properties: [] } })
        expect(await camera.refreshPropertyStates()).toEqual([])
    })
})

describe('Sony preview results', () => {
    it('waits for advertised live-view readiness before requesting the image', async () => {
        const { camera, replies, sent } = cameraFixture()
        const status = (value: number) => descriptor(0xd221, value)
        replies.push({ code: 0x2001, data: { properties: [status(0)] } })
        await camera.refreshPropertyStates()
        const bytes = liveViewFrame()
        replies.push({ code: 0x2001, data: { properties: [status(1)] } }, { code: 0x2001, data: bytes })
        expect((await camera.captureLiveView({ includeInfo: false })).data).toEqual(bytes.slice(24))
        expect(sent.slice(-2)).toEqual(['SDIO_GetAllExtDevicePropInfo', 'GetObject'])
    })

    it('asks again when the next live-view frame is not ready yet, then reads the image at its declared offset', async () => {
        const { camera, replies } = cameraFixture()
        const bytes = liveViewFrame()
        replies.push({ code: 0x200f, data: new Uint8Array(4) }, { code: 0x2001, data: bytes })
        expect((await camera.captureLiveView({ includeInfo: false })).data).toEqual(bytes.slice(24))
    })

    it.each([
        { code: 0x2019 },
        { code: 0x2001 },
        { code: 0x2001, data: new Uint8Array() },
        { code: 0x2001, data: new Uint8Array(16) },
    ])('does not count an unsuccessful image (%o) as a frame', async reply => {
        const { camera, replies } = cameraFixture()
        replies.push(reply)
        const failure = camera.captureLiveView({ includeInfo: false })
        await expect(failure).rejects.toThrow(reply.code === 0x2001 ? /no (dataset|image)/ : undefined)
        expect(camera.millisecondsUntilNextLiveViewFrame()).toBe(0)
    })

    it('bounds polling for a delayed frame without treating the card as unavailable', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] })
        try {
            const { camera, sent } = cameraFixture()
            const bytes = liveViewFrame()
            const started = Date.now()
            const requestTimes: number[] = []
            camera.send = (async operation => {
                sent.push(operation.name)
                requestTimes.push(Date.now() - started)
                return Date.now() - started < 33 ? { code: 0x200f } : { code: 0x2001, data: bytes }
            }) as typeof camera.send
            const result = camera.captureLiveView({ includeInfo: false })
            await vi.runAllTimersAsync()
            expect((await result).data).toEqual(bytes.slice(24))
            expect(requestTimes.length).toBeLessThanOrEqual(8)
            expect(requestTimes.at(-1)).toBeLessThanOrEqual(41)
            expect(sent.every(name => name === 'GetObject')).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

    it('keeps a persistent refusal terminal and stops polling at the deadline', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'performance'] })
        try {
            const { camera } = cameraFixture()
            const started = Date.now()
            const requestTimes: number[] = []
            const otherRequests: string[] = []
            camera.send = (async operation => {
                if (operation.name === 'GetObject') requestTimes.push(Date.now() - started)
                else otherRequests.push(operation.name)
                return { code: 0x200f }
            }) as typeof camera.send
            const rejected = expect(camera.captureLiveView({ includeInfo: false })).rejects.toMatchObject({
                code: 0x200f,
            })
            await vi.runAllTimersAsync()
            await rejected
            // After the deadline it tries one return to shooting (leave transfer mode, 100 ms, read
            // back), which the body also refuses; the frame is not asked for again.
            expect(Date.now() - started).toBe(250)
            expect(otherRequests).toEqual(['SDIO_SetContentsTransferMode', 'SDIO_GetAllExtDevicePropInfo'])
            expect(requestTimes.length).toBeLessThanOrEqual(22)
            expect(requestTimes.every(time => time < 150)).toBe(true)
        } finally {
            vi.useRealTimers()
        }
    })

})

describe('Sony partial downloads', () => {
    it('rejects a chunk longer than requested without retrying', async () => {
        const { camera, replies, sent } = cameraFixture()
        Object.assign(camera, { contentTransferModeEnabled: true })
        replies.push({ code: 0x2001, data: new Uint8Array(6) })
        await expect(camera.getObject(7, 5)).rejects.toThrow()
        expect(sent).toEqual(['SDIO_GetPartialLargeObject'])
    })
})

describe('Canon shutter results', () => {
    it('names the reason the body gave, and keeps the wording other code matches on', async () => {
        const { assertCanonCaptureResult } = await import('@vendors/canon/capture-result')
        expect(() => assertCanonCaptureResult([0], 'release')).not.toThrow()
        expect(() => assertCanonCaptureResult(undefined, 'release')).not.toThrow()
        expect(() => assertCanonCaptureResult([1], 'AF focus press')).toThrow(
            'Canon AF focus press rejected capture with shutter result 0x1: the camera could not focus (low contrast or too dark)'
        )
        expect(() => assertCanonCaptureResult([12], 'release')).toThrow(/movie configuration prevents still capture/)
        expect(() => assertCanonCaptureResult([14], 'release')).toThrow(/the camera is in movie mode/)
        expect(() => assertCanonCaptureResult([2], 'release')).toThrow(/shutter result 0x2$/)
    })
})
