import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

function cameraWithResponses(responses: number[]) {
    const transport = {
        isLittleEndian: () => true,
        on: () => undefined,
    } as unknown as TransportInterface
    const camera = new CanonCamera(
        transport,
        new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
    )
    const operations: Array<{ name: string; params: unknown }> = []
    camera.send = (async (operation, params) => {
        operations.push({ name: operation.name, params })
        return { code: responses.shift() ?? 0x2001 }
    }) as typeof camera.send
    return { camera, operations }
}

describe('Canon capture response handling', () => {
    it('retries without autofocus after DeviceBusy and releases every pressed control', async () => {
        const { camera, operations } = cameraWithResponses([
            0x2001,
            0x2019,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
        ])

        await expect(camera.captureImage({ includeInfo: false, includeData: false })).resolves.toEqual({})
        expect(operations.map(operation => operation.name)).toEqual([
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOff',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOff',
            'CanonRemoteReleaseOff',
        ])
        expect(operations[0]?.params).toEqual({ ReleaseMode: 'FOCUS', AFMode: 'AF' })
        expect(operations[3]?.params).toEqual({ ReleaseMode: 'FOCUS', AFMode: 'MF' })
    })

    it('releases shutter and focus after accepted capture commands', async () => {
        const { camera, operations } = cameraWithResponses([0x2001, 0x2001, 0x2001, 0x2001])

        await expect(camera.captureImage({ includeInfo: false, includeData: false })).resolves.toEqual({})
        expect(operations.map(operation => operation.name)).toEqual([
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOff',
            'CanonRemoteReleaseOff',
        ])
    })
})

function cameraWithCard() {
    const { camera, operations } = cameraWithResponses([])
    let captured = false
    let discoveries = 0
    const image = { filename: 'IMG_0002.JPG', objectCompressedSize: 5, associationType: 0 }
    const bytes = new Uint8Array([0xff, 0xd8, 1, 0xff, 0xd9])
    camera.send = (async (operation, parameters) => {
        const params = parameters as Record<string, number | string>
        operations.push({ name: operation.name, params })
        if (operation.name === 'CanonRemoteReleaseOn' && params.ReleaseMode === 'SHUTTER') captured = true
        if (operation.name === 'CanonGetEventData') return { code: 0x2001, data: [] }
        if (operation.name === 'GetStorageIDs') return { code: 0x2001, data: [0x10000, 0x10001] }
        if (operation.name === 'GetObjectHandles') {
            if (captured) discoveries++
            return { code: 0x2001, data: captured ? [1, 2, 3] : [1] }
        }
        if (operation.name === 'GetObjectInfo') {
            if (params.ObjectHandle === 1) throw new Error('Old card metadata must not be enumerated')
            if (params.ObjectHandle === 3) return { code: 0x2001, data: { ...image, filename: 'MISC', associationType: 1 } }
            return { code: 0x2001, data: { ...image, objectCompressedSize: discoveries === 1 ? 0 : image.objectCompressedSize } }
        }
        if (operation.name === 'GetPartialObject') {
            const offset = Number(params.Offset)
            return { code: 0x2001, data: bytes.slice(offset, offset + 2) }
        }
        return { code: 0x2001 }
    }) as typeof camera.send
    return { camera, operations, image, bytes }
}

describe('Canon capture data and information', () => {
    it('waits for a new completed image, skips folders and reads only new-object metadata', async () => {
        const { camera, operations, image, bytes } = cameraWithCard()
        await expect(camera.captureImage()).resolves.toEqual({ info: image, data: bytes })
        expect(operations.filter(operation => operation.name === 'GetObjectHandles').every(operation =>
            (operation.params as { StorageID: number }).StorageID === 0x10001)).toBe(true)
        expect(operations.filter(operation => operation.name === 'GetPartialObject').map(operation => operation.params))
            .toEqual([
                { ObjectHandle: 2, Offset: 0, MaxBytes: 5 },
                { ObjectHandle: 2, Offset: 2, MaxBytes: 3 },
                { ObjectHandle: 2, Offset: 4, MaxBytes: 1 },
            ])
    })

    it('supports information-only capture without transferring bytes', async () => {
        const { camera, operations, image } = cameraWithCard()
        await expect(camera.captureImage({ includeInfo: true, includeData: false })).resolves.toEqual({ info: image })
        expect(operations.some(operation => operation.name === 'GetPartialObject')).toBe(false)
    })

    it('gets the correct transfer size even when callers do not request information', async () => {
        const { camera, bytes } = cameraWithCard()
        await expect(camera.captureImage({ includeInfo: false, includeData: true })).resolves.toEqual({ data: bytes })
    })

    it('does not fire the shutter when card discovery fails', async () => {
        const { camera, operations } = cameraWithResponses([0x201d])
        await expect(camera.captureImage()).rejects.toThrow('capture storage discovery')
        expect(operations.map(operation => operation.name)).toEqual(['GetStorageIDs'])
    })

    it('times out when no new image appears without returning an old file or firing again', async () => {
        vi.useFakeTimers()
        const { camera, operations } = cameraWithCard()
        const send = camera.send.bind(camera)
        camera.send = (async (operation, parameters) => operation.name === 'GetObjectHandles'
            ? { code: 0x2001, data: [1] } : send(operation, parameters)) as typeof camera.send
        try {
            const rejected = expect(camera.captureImage()).rejects.toThrow('no new image')
            await vi.runAllTimersAsync()
            await rejected
            expect(operations.filter(operation => operation.name === 'CanonRemoteReleaseOn' &&
                (operation.params as { ReleaseMode: string }).ReleaseMode === 'SHUTTER')).toHaveLength(1)
            expect(operations.filter(operation => operation.name === 'GetPartialObject')).toEqual([])
        } finally { vi.useRealTimers() }
    })

    it('reports a failed download after releasing controls without taking a second photo', async () => {
        const { camera, operations } = cameraWithCard()
        const send = camera.send.bind(camera)
        camera.send = (async (operation, parameters) => operation.name === 'GetPartialObject'
            ? { code: 0x201d, data: new Uint8Array() } : send(operation, parameters)) as typeof camera.send
        await expect(camera.captureImage()).rejects.toThrow('GetPartialObject')
        expect(operations.filter(operation => operation.name === 'CanonRemoteReleaseOff')).toHaveLength(2)
        expect(operations.filter(operation => operation.name === 'CanonRemoteReleaseOn' &&
            (operation.params as { ReleaseMode: string }).ReleaseMode === 'SHUTTER')).toHaveLength(1)
    })

    it('rejects an unsuccessful KeepDeviceOn response', async () => {
        const { camera } = cameraWithResponses([0x2019])
        await expect(camera.keepDeviceOn()).rejects.toThrow('keep device on')
    })
})

describe('bounded partial-object transfer', () => {
    it.each([
        [{ code: 0x2001, data: new Uint8Array() }, 'made no progress'],
        [{ code: 0x2001, data: new Uint8Array(6) }, 'exceeded'],
        [{ code: 0x201d, data: new Uint8Array(5) }, '0x201d'],
    ])('rejects invalid chunks rather than hanging or claiming success (%#)', async (response, message) => {
        const { camera } = cameraWithResponses([])
        camera.send = (async () => response) as typeof camera.send
        await expect(camera.getObject(2, 5)).rejects.toThrow(message)
    })

    it('rejects invalid sizes before USB work', async () => {
        const { camera, operations } = cameraWithResponses([])
        await expect(camera.getObject(2, -1)).rejects.toThrow('byte count')
        await expect(camera.getObject(2, Number.NaN)).rejects.toThrow('byte count')
        expect(operations).toEqual([])
    })
})

describe('Canon capture destination', () => {
    it('preserves body-specific values and verifies an advertised destination write', async () => {
        const { camera } = cameraWithResponses([])
        const processEvents = (camera as unknown as { processEvents(events: unknown[]): void }).processEvents.bind(camera)
        processEvents([
            { code: 0xc189, parameters: [0xd11c, 2] },
            { code: 0xc18a, parameters: [0xd11c], allowedValues: [2, 6, 4] },
        ])
        expect(await camera.getCaptureDestination()).toBe(2)
        const writes: Uint8Array[] = []
        camera.send = (async (operation, _parameters, data) => {
            if (operation.code === 0x9110) writes.push(data!)
            return operation.name === 'CanonGetEventData'
                ? { code: 0x2001, data: [{ code: 0xc189, parameters: [0xd11c, 6] }] }
                : { code: 0x2001 }
        }) as typeof camera.send
        await expect(camera.setCaptureDestination(1)).rejects.toThrow('advertised')
        expect(writes).toEqual([])
        await camera.setCaptureDestination(6)
        expect(await camera.getCaptureDestination()).toBe(6)
        expect(new DataView(writes[0]!.buffer).getUint32(8, true)).toBe(6)
    })
})


describe('Canon camera release result carried by a PTP OK response', () => {
    it.each(['FOCUS', 'SHUTTER'])('rejects nonzero %s status and releases pressed controls without retrying', async mode => {
        vi.useFakeTimers()
        const { camera, operations } = cameraWithResponses([])
        const send = camera.send.bind(camera)
        camera.send = (async (operation, parameters) => {
            const response = await send(operation, parameters)
            const reject = operation.name === 'CanonRemoteReleaseOn' &&
                (parameters as { ReleaseMode: string }).ReleaseMode === mode
            return { ...response, parameters: [reject ? 12 : 0] }
        }) as typeof camera.send
        try {
            const rejected = expect(camera.captureImage({ includeInfo: false, includeData: false }))
                .rejects.toThrow('SDK 0x8d0c (TAKE_PICTURE_SPECIAL_MOVIE_MODE_NG)')
            await vi.runAllTimersAsync()
            await rejected
            expect(operations.filter(item => item.name === 'CanonRemoteReleaseOff').map(item => item.params))
                .toEqual(mode === 'FOCUS' ? [{ ReleaseMode: 'FOCUS' }] :
                    [{ ReleaseMode: 'SHUTTER' }, { ReleaseMode: 'FOCUS' }])
            expect(operations.filter(item => item.name === 'CanonRemoteReleaseOn'))
                .toHaveLength(mode === 'FOCUS' ? 1 : 2)
            expect(operations.some(item => item.name === 'GetObjectHandles')).toBe(false)
        } finally { vi.useRealTimers() }
    })

    it('preserves USB response parameter words through GenericCamera.send', async () => {
        const packet = new Uint8Array(16)
        const view = new DataView(packet.buffer)
        view.setUint32(0, 16, true)
        view.setUint16(4, 3, true)
        view.setUint16(6, 0x2001, true)
        view.setUint32(8, 1, true)
        view.setUint32(12, 12, true)
        const transport = {
            isLittleEndian: () => true,
            on: () => undefined,
            send: async () => undefined,
            receive: async () => packet,
        } as unknown as TransportInterface
        const camera = new CanonCamera(transport,
            new Logger({ expanded: false, captureConsole: false, renderInTerminal: false }))
        const response = await camera.send(
            camera.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'SHUTTER', AFMode: 'MF' })
        expect(response).toMatchObject({ code: 0x2001, parameters: [12] })
    })
})
