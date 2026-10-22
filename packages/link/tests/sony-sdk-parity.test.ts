import { SonyWifiCamera, type SonySdkBridge } from '@vendors/sony/sdk-camera'
import { describe, expect, it } from 'vitest'

function sdkCamera(ignoreFirstPoint = false) {
    const properties = [
        { code: 256, type: 2, value: '1400', writable: true, allowedValues: ['1400', '1600'] },
        { code: 259, type: 3, value: '0', writable: true },
        { code: 260, type: 3, value: '3200', writable: true, allowedValues: ['3200', '6400'] },
        { code: 262, type: 2, value: '1', writable: true, allowedValues: ['1', '2', '3'] },
        { code: 263, type: 2, value: '3', writable: true, allowedValues: ['1', '2', '3', '4'] },
        { code: 264, type: 2, value: '0', writable: true, allowedValues: ['0', '17'] },
        { code: 265, type: 2, value: '4', writable: true, allowedValues: ['1', '2', '3', '4'] },
        { code: 272, type: 2, value: '1', writable: true, allowedValues: ['1', '2', '3'] },
        { code: 273, type: 2, value: '1', writable: true, allowedValues: ['1', '2'] },
        { code: 275, type: 2, value: '1', writable: true, allowedValues: ['1', '4'] },
        { code: 281, type: 2, value: '2', writable: true, allowedValues: ['1', '2', '3'] },
        { code: 282, type: 2, value: '1', writable: true, allowedValues: ['1', '2'] },
        { code: 293, type: 2, value: '1', writable: true, allowedValues: ['1', '3', '4'] },
        { code: 295, type: 2, value: '3', writable: true, allowedValues: ['2', '3', '5'] },
        { code: 296, type: 2, value: '63', writable: true, allowedValues: ['61', '63', '66'] },
    ]
    let point = { x: 320, y: 240 },
        downloadFails = false
    const requests: Record<string, string>[] = []
    let positionWrites = 0
    const bridge: SonySdkBridge = {
        request: async request => {
            requests.push(request)
            if (request.cmd === 'properties') return { properties: properties.map(property => ({ ...property })) }
            if (request.cmd === 'set') {
                const property = properties.find(property => property.code === Number(request.code))
                if (property) property.value = request.value!
                if (request.code === '289') {
                    if (ignoreFirstPoint && positionWrites++ === 0) return { ok: true }
                    const value = Number(request.value)
                    point = { x: value >>> 16, y: value & 65535 }
                }
            }
            if (request.cmd === 'focus_frames')
                return {
                    frames: [
                        { xNumerator: point.x, yNumerator: point.y, xDenominator: 640, yDenominator: 480, state: 1 },
                    ],
                }
            if (request.cmd === 'wait_download') {
                if (downloadFails) throw new Error('Transfer failed')
                return { path: '/tmp/sdk-test/DG00001.JPG' }
            }
            return { ok: true }
        },
        close: async () => {},
    }
    const camera = new SonyWifiCamera(bridge)
    return {
        camera,
        properties,
        requests,
        failDownload: () => {
            downloadFails = true
        },
    }
}
describe('Sony Wi-Fi USB control parity', () => {
    it('converts familiar exposure, focus, format and quality values to SDK choices', async () => {
        const { camera, properties } = sdkCamera()
        await camera.connectUsb('unit-test')
        for (const [action, value, code, expected] of [
            ['set-aperture', 'f/16', 256, '1600'],
            ['set-iso', '6400', 260, '6400'],
            ['set-shutter-speed', '1/125', 259, String((1 << 16) | 125)],
            ['set-focus-mode', 'AF-S', 265, '2'],
            ['set-white-balance', 'Daylight', 264, '17'],
            ['set-image-format', 'RAW + JPEG', 262, '3'],
            ['set-jpeg-quality', 'Extra Fine', 263, '4'],
            ['set-image-size', 'M', 272, '2'],
            ['set-aspect-ratio', '16:9', 273, '2'],
            ['set-movie-format', 'XAVC S 4K', 295, '2'],
            ['set-zoom-setting', 'Clear Image Zoom', 293, '3'],
        ] as const) {
            await camera.applySonyControl(action, value)
            expect(properties.find(property => property.code === code)!.value).toBe(expected)
        }
        const status = (await camera.applySonyControl('status')) as any
        expect(status.controls.movieSetting.allowedValues).toHaveLength(3)
        const choice = status.controls.movieSetting.allowedValues[0]
        await camera.applySonyControl('set-movie-setting', choice)
        expect(properties.find(property => property.code === 296)!.value).toBe('61')
    }, 15000)
    it('confirms AF placement against live-view frames without changing exposure mode', async () => {
        const { camera, requests } = sdkCamera()
        await camera.connectUsb('unit-test')
        expect(await camera.placeSonyFocusPoint(180, 160)).toMatchObject({
            positionVerified: true,
            requested: { x: 180, y: 160 },
            focusAcquired: false,
        })
        expect(requests.filter(request => request.cmd === 'set').map(request => request.code)).toEqual([
            '282',
            '275',
            '289',
        ])
        await expect(camera.placeSonyFocusPoint(640, 100)).rejects.toThrow('640×480')
    })
    it('repeats only the same AF point once when a new session has not applied its first position', async () => {
        const { camera, requests } = sdkCamera(true)
        await camera.connectUsb('unit-test')
        const result = await camera.placeSonyFocusPoint(160, 160)
        expect(result.positionVerified).toBe(true)
        const positions = requests.filter(request => request.cmd === 'set' && request.code === '289')
        expect(positions).toHaveLength(2)
        expect(positions[0]).toEqual(positions[1])
        expect(requests.some(request => request.cmd === 'set' && request.code === '261')).toBe(false)
    })
    it('waits for the SDK download callback and restores the original card destination', async () => {
        const { camera, properties, requests } = sdkCamera()
        await camera.connectUsb('unit-test')
        expect(await camera.captureAndDownload('/tmp/sdk-test')).toEqual({ path: '/tmp/sdk-test/DG00001.JPG' })
        expect(properties.find(property => property.code === 281)!.value).toBe('2')
        expect(requests.some(request => request.cmd === 'wait_download')).toBe(true)
    })
    it('waits for both RAW and JPEG callbacks for paired capture', async () => {
        const { camera, properties, requests } = sdkCamera()
        await camera.connectUsb('unit-test')
        properties.find(property => property.code === 262)!.value = '3'
        await camera.captureAndDownload('/tmp/sdk-test')
        expect(requests.find(request => request.cmd === 'wait_download')?.count).toBe('2')
    })
    it('prepares PC delivery again when the camera retained a PC-only destination', async () => {
        const { camera, properties, requests } = sdkCamera()
        properties.find(property => property.code === 281)!.value = '1'
        await camera.connectUsb('unit-test')
        await camera.captureAndDownload('/tmp/sdk-test')
        const destination = requests.findIndex(request => request.cmd === 'set' && request.code === '281')
        const shutter = requests.findIndex(request => request.cmd === 'command')
        expect(destination).toBeGreaterThanOrEqual(0)
        expect(requests[destination]!.value).toBe('1')
        expect(destination).toBeLessThan(shutter)
        const priority = requests.findIndex(
            request => request.cmd === 'set' && request.code === '282' && request.value === '2'
        )
        expect(priority).toBeGreaterThanOrEqual(0)
        expect(priority).toBeLessThan(shutter)
        expect(properties.find(property => property.code === 282)!.value).toBe('1')
    })
    it('restores the destination when photo transfer fails', async () => {
        const { camera, properties, failDownload } = sdkCamera()
        await camera.connectUsb('unit-test')
        failDownload()
        await expect(camera.captureAndDownload('/tmp/sdk-test')).rejects.toThrow('Transfer failed')
        expect(properties.find(property => property.code === 281)!.value).toBe('2')
    })
})
