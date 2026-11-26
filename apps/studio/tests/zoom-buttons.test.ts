import { CameraService } from '@main/camera-service'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({
    stopSwiftLiveView: () => {},
    onUsbTransportChanged: () => {},
}))
vi.mock('usb', async () => {
    const { EventEmitter } = await import('node:events')
    return { usb: new EventEmitter() }
})

function fixture() {
    const calls: string[] = []
    const camera = {
        startZoom: vi.fn(async (direction: string) => void calls.push(`start ${direction}`)),
        stopZoom: vi.fn(async () => void calls.push('stop')),
        getCapabilities: vi.fn(async () => ({ observedAt: Date.now(), advertisedOperations: [], controls: {} })),
        getInstance: () => ({}),
    }
    const service = new CameraService()
    Object.assign(service, { camera, connected: true })
    vi.spyOn(service, 'scheduleSettingsRefresh').mockImplementation(() => undefined)
    return { service, camera, calls }
}

/** Holds Studio's queue (as a live-view frame waiting for the camera's next frame would) until released. */
function holdQueue(service: CameraService): () => void {
    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    void service.enqueue(() => held)
    return release
}

describe('zoom buttons', () => {
    it('never starts a press released while it waited in the queue', async () => {
        const { service, camera, calls } = fixture()
        const release = holdQueue(service)
        const press = service.zoomStart('tele')
        await service.zoomStop()
        release()
        await press
        expect(camera.startZoom).not.toHaveBeenCalled()
        expect(calls).toEqual(['stop'])
    })

    it('starts a press that reached the camera, and the release stops it', async () => {
        const { service, calls } = fixture()
        await service.zoomStart('wide')
        await service.zoomStop()
        expect(calls).toEqual(['start out', 'stop'])
    })

    it('starts a new press after an earlier release', async () => {
        const { service, calls } = fixture()
        await service.zoomStop()
        const release = holdQueue(service)
        const press = service.zoomStart('tele')
        release()
        await press
        expect(calls).toEqual(['stop', 'start in'])
    })
})
