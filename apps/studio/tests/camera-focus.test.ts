import type { Camera, FocusResult } from '@darkgrade/slate'
import { CameraUnsupportedError } from '@darkgrade/slate'
import { CameraService } from '@main/camera-service'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({ stopSwiftLiveView: () => {}, onUsbTransportChanged: () => {} }))
vi.mock('usb', async () => {
    const { EventEmitter } = await import('node:events')
    return { usb: new EventEmitter() }
})

/** Studio's click-to-focus, Focus button and F key go through Slate's generic focus operations only. */
function fixture(result: FocusResult = 'acquired') {
    const order: string[] = []
    const camera = {
        autofocus: vi.fn(async () => {
            order.push('autofocus')
            return result
        }),
        setFocusPoint: vi.fn(async () => {
            order.push('setFocusPoint')
        }),
        resetFocusPoint: vi.fn(async () => {
            order.push('resetFocusPoint')
        }),
        getInstance: () => ({}),
    }
    const service = new CameraService()
    Object.assign(service, { camera: camera as unknown as Camera, connected: true })
    return { service, camera, order }
}

describe('Studio focus', () => {
    it('focuses with the camera’s own area and reports what the camera said', async () => {
        expect(await fixture('acquired').service.focus()).toBe('Focused')
        expect(await fixture('not-acquired').service.focus()).toBe('The camera could not focus')
        const { service, order } = fixture('unknown')
        expect(await service.focus()).toBe('Autofocus complete')
        expect(order).toEqual(['autofocus'])
    })

    it('places a click as a 0–1 point and resets it on the next Focus, once', async () => {
        const { service, camera, order } = fixture()
        await service.focusAt(0.25, 0.75)
        expect(camera.setFocusPoint).toHaveBeenCalledWith(0.25, 0.75)
        await service.focus()
        await service.focus()
        expect(order).toEqual(['setFocusPoint', 'resetFocusPoint', 'autofocus', 'autofocus'])
    })

    it('refuses a point outside the picture without calling the camera', async () => {
        const { service, camera } = fixture()
        await expect(service.focusAt(1.5, 0.5)).rejects.toThrow('inside the picture')
        expect(camera.setFocusPoint).not.toHaveBeenCalled()
    })

    it('passes Slate’s reason through when the camera cannot place a point', async () => {
        const { service, camera } = fixture()
        camera.setFocusPoint.mockRejectedValue(new CameraUnsupportedError('setFocusPoint', 'This camera has no remote focus operations that Slate supports'))
        await expect(service.focusAt(0.5, 0.5)).rejects.toThrow('no remote focus operations')
        await service.focus()
        expect(camera.resetFocusPoint).not.toHaveBeenCalled()
    })
})
