import { LocalBench, type LocalCamera, type CameraAdapter } from '../server/host'
import { cameraControlDefinitions, type CameraCapabilities, type CameraControlId, type CameraControlInputs } from '@darkgrade/link/controls'

export class FixtureCamera implements LocalCamera {
    calls: string[] = []
    value = '100'
    failStart = false
    failRead = false
    failWrite = false
    wait: Promise<void> | undefined
    async connect() { this.calls.push('connect'); await this.wait }
    async disconnect() { this.calls.push('disconnect') }
    async getCapabilities(): Promise<CameraCapabilities> {
        if (this.failRead) { this.failRead = false; throw Error('read failed') }
        return { observedAt: Date.now(), advertisedOperations: [],
            controls: { iso: { id: 'iso', ...cameraControlDefinitions.iso,
                source: { name: 'FixtureIso', code: 1, protocol: 'ptp' },
                value: this.value, allowedValues: ['100', '200'], enabled: true, writable: true },
            aperture: { id: 'aperture', ...cameraControlDefinitions.aperture,
                source: { name: 'FixtureAperture', code: 2, protocol: 'ptp' },
                value: 'f/4', allowedValues: ['f/4'], enabled: true, writable: false } } }
    }
    async setControl<Id extends CameraControlId>(id: Id, value: CameraControlInputs[Id]) {
        const state = (await this.getCapabilities()).controls[id]
        if (!state?.enabled || !state.writable || !state.allowedValues?.includes(String(value))) throw Error('This value is not currently advertised and writable')
        this.calls.push(`${id === 'iso' ? 'set' : id}:${String(value)}`)
        await this.wait
        if (id === 'iso') this.value = String(value)
        if (this.failWrite) throw Error('reply lost')
        try { return (await this.getCapabilities()).controls[id]! }
        catch { throw Error('The write completed but readback was not confirmed. Refresh before another write') }
    }
    async captureLiveView() { this.calls.push('frame'); return { data: fixtureImage } }
    async captureImage() { this.calls.push('photo'); return { data: fixtureImage, info: { filename: 'FIXTURE.PNG' } } }
    async startRecording() { this.calls.push('start'); if (this.failStart) throw Error('start reply lost') }
    async stopRecording() { this.calls.push('stop') }
    async prepareRecordingMode() { return { restore: async () => {} } }
    async recover() { this.calls.push('recover'); return { recovered: true } }
}
// Generated solid-color PNG fixture; no camera image or vendor asset is imported.
export const fixtureImage = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGOoaOohCTGMahjVMHw1AABCC4YQ1gfpNgAAAABJRU5ErkJggg=='), character => character.charCodeAt(0))
export function fixtureBench() {
    const camera = new FixtureCamera()
    const adapter: CameraAdapter = {
        discover: async () => [{ vendorId: 0x04b0, productId: 1, serialNumber: 'fixture-camera', model: 'USB camera fixture' }],
        create: () => camera,
    }
    return { bench: new LocalBench(adapter, 'fixture'), camera, adapter }
}
