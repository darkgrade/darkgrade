import { CameraService } from '@main/camera-service'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', getPathForFile: () => '/tmp' } }))
vi.mock('@main/usb-experiments', () => ({ stopSwiftLiveView: () => {}, onUsbTransportChanged: () => {} }))
vi.mock('usb', async () => {
    const { EventEmitter } = await import('node:events')
    return { usb: new EventEmitter() }
})

function fixture() {
    const calls: string[] = []
    const camera = {
        getBattery: vi.fn(async () => (calls.push('battery'), { percent: 80 })),
        stopRecording: vi.fn(async () => (calls.push('stop'), { state: 'idle' })),
        setControl: vi.fn(async () => (calls.push('set'), {})),
    }
    const service = new CameraService()
    Object.assign(service, { camera, connected: true })
    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    void service.enqueue(() => held)
    return { service, calls, release }
}

describe("Studio's camera runtime", () => {
    it('runs a camera tool behind the window’s requests, and stopping before them', async () => {
        const { service, calls, release } = fixture()
        const battery = service.operation('getBattery', {})
        await service.operation('stopRecording', {})
        expect(calls).toEqual(['stop'])
        release()
        expect((await battery).result).toEqual({ percent: 80 })
        expect(calls).toEqual(['stop', 'battery'])
    })

    it('refuses a change while the card is being read, and still allows reads', async () => {
        const { service, release } = fixture()
        release()
        service.storageSessionActive = true
        await expect(service.operation('setControl', { id: 'iso', value: '800' })).rejects.toThrow(/reading its card/)
        await expect(service.operation('getBattery', {})).resolves.toMatchObject({ result: { percent: 80 } })
    })
})
