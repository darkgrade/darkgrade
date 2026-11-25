import type { Camera, CameraCapabilities, CameraControlState, FocusResult } from '@darkgrade/slate'
import { CameraUnsupportedError } from '@darkgrade/slate'
import { CameraService } from '@main/camera-service'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({ stopSwiftLiveView: () => {}, onUsbTransportChanged: () => {} }))
vi.mock('usb', async () => {
    const { EventEmitter } = await import('node:events')
    return { usb: new EventEmitter() }
})

function control(id: 'focusArea' | 'subjectDetection', value: string, allowedValues: string[]): CameraControlState {
    return {
        id,
        label: id,
        aliases: [],
        source: { name: id, code: 0, protocol: 'ptp' },
        value,
        allowedValues,
        writable: true,
        enabled: true,
    }
}

/**
 * Studio's click-to-focus, Focus button and F key go through Slate's generic focus operations only.
 * The camera behaves as Slate does on a Sony body: a point from Wide switches to a spot, a point
 * pauses subject detection, and resetFocusPoint puts back what the point changed. Studio never resets:
 * Focus after a click focuses at the clicked point.
 */
function fixture(
    initial: { focusArea?: string | null; subjectDetection?: string | null; result?: FocusResult; canPlace?: boolean } = {}
) {
    const order: string[] = []
    const body = {
        focusArea: initial.focusArea === undefined ? 'Wide' : initial.focusArea,
        subjectDetection: initial.subjectDetection === undefined ? 'On' : initial.subjectDetection,
        areaBeforePoint: null as string | null,
    }
    const capabilities = (): CameraCapabilities => ({
        observedAt: Date.now(),
        controls: {
            ...(body.focusArea !== null && {
                focusArea: control('focusArea', body.focusArea, ['Wide', 'Zone', 'Spot M', 'Tracking Spot M']),
            }),
            ...(body.subjectDetection !== null && {
                subjectDetection: control('subjectDetection', body.subjectDetection, ['Off', 'On']),
            }),
        },
        advertisedOperations: null,
        operations: {
            setFocusPoint:
                initial.canPlace === false ? { supported: false, reason: 'No focus point here' } : { supported: true },
        },
    })
    const camera = {
        getCapabilities: vi.fn(async () => capabilities()),
        autofocus: vi.fn(async () => {
            order.push('autofocus')
            return initial.result ?? 'acquired'
        }),
        setFocusPoint: vi.fn(async () => {
            order.push('setFocusPoint')
            if (body.focusArea && !/spot/i.test(body.focusArea)) {
                body.areaBeforePoint = body.focusArea
                body.focusArea = 'Spot M'
            }
            if (body.subjectDetection === 'On') body.subjectDetection = 'Off'
        }),
        resetFocusPoint: vi.fn(async () => {
            order.push('resetFocusPoint')
            if (body.areaBeforePoint) body.focusArea = body.areaBeforePoint
            body.areaBeforePoint = null
            if (body.subjectDetection === 'Off') body.subjectDetection = 'On'
        }),
        setSubjectDetection: vi.fn(async (value: string) => {
            order.push(`setSubjectDetection ${value}`)
            body.subjectDetection = value
            return value
        }),
        getInstance: () => ({}),
    }
    const service = new CameraService()
    Object.assign(service, { camera: camera as unknown as Camera, connected: true })
    return { service, camera, order, body }
}

async function connectedFixture(initial: Parameters<typeof fixture>[0] = {}) {
    const fixtureState = fixture(initial)
    await fixtureState.service.refreshSettingsRaw()
    return fixtureState
}

describe('Studio focus', () => {
    it('focuses with the camera’s own area and reports what the camera said', async () => {
        expect(await fixture({ result: 'acquired' }).service.focus()).toBe('Focused')
        expect(await fixture({ result: 'not-acquired' }).service.focus()).toBe('The camera could not focus')
        const { service, order } = fixture({ result: 'unknown' })
        expect(await service.focus()).toBe('Autofocus complete')
        expect(order).toEqual(['autofocus'])
    })

    it('after a click from Wide, Focus and F focus at the clicked point without recentring', async () => {
        const { service, camera, order, body } = await connectedFixture()
        await service.focusAt(0.25, 0.75)
        expect(camera.setFocusPoint).toHaveBeenCalledWith(0.25, 0.75)
        // The panel shows what the camera now uses.
        expect(service.getState().controls?.focusArea?.value).toBe('Spot M')
        await service.focus()
        await service.focus()
        expect(camera.resetFocusPoint).not.toHaveBeenCalled()
        expect(order).toEqual(['setFocusPoint', 'autofocus', 'autofocus'])
        expect(body).toMatchObject({ focusArea: 'Spot M', subjectDetection: 'Off' })
    })

    it('after a click in the user’s own spot, Focus keeps the point', async () => {
        const { service, camera, order, body } = await connectedFixture({ focusArea: 'Tracking Spot M', subjectDetection: 'Off' })
        await service.focusAt(0.6, 0.4)
        await service.focus()
        expect(camera.resetFocusPoint).not.toHaveBeenCalled()
        expect(order).toEqual(['setFocusPoint', 'autofocus'])
        expect(body.focusArea).toBe('Tracking Spot M')
    })

    it('on a camera without focus-area settings (Nikon), F focuses at the clicked point without a reset', async () => {
        const { service, camera, order } = await connectedFixture({ focusArea: null, subjectDetection: null })
        const reads = camera.getCapabilities.mock.calls.length
        await service.focusAt(0.6, 0.4)
        expect(camera.getCapabilities.mock.calls.length).toBe(reads)
        await service.focus()
        expect(order).toEqual(['setFocusPoint', 'autofocus'])
    })

    it('offers click-to-focus only when Slate says a focus point can be placed', async () => {
        expect((await connectedFixture()).service.getState().clickToFocus).toBe(true)
        expect((await connectedFixture({ canPlace: false })).service.getState().clickToFocus).toBe(false)
        expect(fixture().service.getState().clickToFocus).toBe(false)
    })

    it('refuses a point outside the picture without calling the camera', async () => {
        const { service, camera } = fixture()
        await expect(service.focusAt(1.5, 0.5)).rejects.toThrow('inside the picture')
        expect(camera.setFocusPoint).not.toHaveBeenCalled()
    })

    it('passes Slate’s reason through when the camera cannot place a point', async () => {
        const { service, camera } = await connectedFixture()
        camera.setFocusPoint.mockRejectedValue(
            new CameraUnsupportedError('setFocusPoint', 'This camera has no remote focus operations that Slate supports')
        )
        await expect(service.focusAt(0.5, 0.5)).rejects.toThrow('no remote focus operations')
    })
})
