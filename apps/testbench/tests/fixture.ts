import { LocalBench, type LocalCamera, type CameraAdapter } from '../server/host'
import type { BenchControl, SettingName } from '../src/contracts'

export class FixtureCamera implements LocalCamera {
    calls: string[] = []
    value = '100'
    failStart = false
    failRead = false
    failWrite = false
    wait: Promise<void> | undefined
    async connect() { this.calls.push('connect'); await this.wait }
    async disconnect() { this.calls.push('disconnect') }
    async getIso() { if (this.failRead) { this.failRead = false; throw Error('read failed') } return this.value }
    async getAperture() { return 'f/4' }
    async getShutterSpeed() { return '1/125' }
    async getWhiteBalance() { return 'Daylight' }
    async setIso(value: string) { this.calls.push('set:' + value); await this.wait; this.value = value; if (this.failWrite) throw Error('reply lost') }
    async setAperture() {}
    async setShutterSpeed() {}
    async setWhiteBalance() {}
    async getStandardPropertyStates() { return [{ name: 'ExposureIndex', value: this.value, allowedValues: ['100', '200'], writable: true }] }
    getSonyPropertyStates = this.getStandardPropertyStates
    getCanonPropertyStates = this.getStandardPropertyStates
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
        controls: async () => {
            if (camera.failRead) { camera.failRead = false; throw Error('read failed') }
            return { iso: { value: camera.value, choices: ['100', '200'], enabled: true },
                aperture: { value: 'f/4', choices: ['f/4'], enabled: false } } satisfies Partial<Record<SettingName, BenchControl>>
        },
    }
    return { bench: new LocalBench(adapter, 'fixture'), camera, adapter }
}
