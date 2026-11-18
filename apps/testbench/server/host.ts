import { CameraRuntime } from '@darkgrade/link/runtime'
import { settingNames, type BenchAction, type BenchCamera, type BenchControl, type BenchState, type SettingName } from '../src/contracts'

export type USBIdentity = { vendorId: number; productId: number; serialNumber?: string; model?: string }
type PropertyState = { name: string; value: unknown; allowedValues?: unknown[]; writable?: boolean; enabled?: boolean; access?: string }
export interface LocalCamera {
    connect(): Promise<void>
    disconnect(): Promise<void>
    getIso(): Promise<string>
    getAperture(): Promise<string>
    getShutterSpeed(): Promise<string>
    getWhiteBalance(): Promise<string>
    setIso(value: string): Promise<void>
    setAperture(value: string): Promise<void>
    setShutterSpeed(value: string): Promise<void>
    setWhiteBalance(value: string): Promise<void>
    getStandardPropertyStates(): Promise<PropertyState[]>
    getSonyPropertyStates(): Promise<PropertyState[]>
    getCanonPropertyStates(): Promise<PropertyState[]>
    captureLiveView(options: { includeInfo: boolean; includeData: boolean }): Promise<{ data?: Uint8Array }>
    captureImage(options: { includeInfo: boolean; includeData: boolean; autofocus: boolean; destination?: 'memory' }): Promise<{ data?: Uint8Array; info?: { filename?: string } }>
    startRecording(): Promise<void>
    stopRecording(): Promise<void>
    recover(options: { allowPortReset: boolean }): Promise<{ recovered: boolean }>
}
type Entry = { identity: USBIdentity; view: BenchCamera; camera?: LocalCamera; ambiguous?: boolean }
export type CameraAdapter = {
    discover(): Promise<USBIdentity[]>
    create(identity: USBIdentity): LocalCamera
    controls?(camera: LocalCamera, identity: USBIdentity): Promise<Partial<Record<SettingName, BenchControl>>>
}
export type MediaResult = { bytes: Uint8Array; filename: string; contentType: string }
const methods = {
    iso: ['getIso', 'setIso'], aperture: ['getAperture', 'setAperture'],
    shutterSpeed: ['getShutterSpeed', 'setShutterSpeed'], whiteBalance: ['getWhiteBalance', 'setWhiteBalance'],
} as const
const aliases = {
    iso: ['Iso', 'CanonIso', 'ExposureIndex'],
    aperture: ['Aperture', 'CanonAperture', 'FNumber'],
    shutterSpeed: ['ShutterSpeed', 'CanonShutterSpeed', 'ExposureTime'],
    whiteBalance: ['WhiteBalance', 'CanonWhiteBalance'],
}
const message = (error: unknown) => error instanceof Error ? error.message : 'Camera operation failed'
const identityKey = (identity: USBIdentity) => JSON.stringify([identity.vendorId, identity.productId, identity.serialNumber ?? ''])

/** Local USB ownership only. All operations share Link's queue; no controller or power hardware is required. */
export class LocalBench {
    private entries = new Map<string, Entry>()
    private identityIds = new Map<string, string>()
    private scans: Promise<BenchState> | undefined
    private runtime: CameraRuntime
    constructor(private adapter: CameraAdapter, private source: BenchState['source'] = 'hardware') {
        this.runtime = new CameraRuntime({
            session: () => undefined,
            assertControlAllowed: () => undefined,
            invalidate: () => undefined,
            control: async () => { throw Error('Use the local host action contract') },
            observeControls: async (_id, state) => state,
            media: async () => { throw Error('Use the local host action contract') },
        })
    }
    state(): BenchState {
        return { source: this.source, cameras: [...this.entries.values()].map(entry => structuredClone(entry.view)) }
    }
    scan(): Promise<BenchState> {
        if (this.scans) return this.scans
        this.scans = this.discover().finally(() => { this.scans = undefined })
        return this.scans
    }
    private async discover() {
        const found = await this.adapter.discover()
        const counts = new Map<string, number>()
        for (const device of found) counts.set(identityKey(device), (counts.get(identityKey(device)) ?? 0) + 1)
        for (const device of found) {
            const key = identityKey(device)
            let id = this.identityIds.get(key)
            if (!id) { id = crypto.randomUUID(); this.identityIds.set(key, id) }
            if (!this.entries.has(id)) this.entries.set(id, { identity: device, view: {
                id, name: device.model || 'USB camera', connected: false, recording: 'idle', controls: {},
                canRecord: [0x054c, 0x04b0, 0x04a9].includes(device.vendorId),
            } })
            const entry = this.entries.get(id)!
            entry.ambiguous = counts.get(key)! > 1
            if (!entry.camera) entry.view.error = entry.ambiguous
                ? 'These cameras have no unique USB identity; connect one at a time' : undefined
        }
        for (const [id, entry] of this.entries)
            if (!found.some(device => identityKey(device) === identityKey(entry.identity)) && !entry.camera)
                this.entries.delete(id)
        return this.state()
    }
    private async read(entry: Entry) {
        const camera = entry.camera!
        if (this.adapter.controls) {
            entry.view.controls = await this.adapter.controls(camera, entry.identity)
            return
        }
        const states = await (entry.identity.vendorId === 0x054c ? camera.getSonyPropertyStates()
            : entry.identity.vendorId === 0x04a9 ? camera.getCanonPropertyStates()
            : camera.getStandardPropertyStates())
        const controls: Partial<Record<SettingName, BenchControl>> = {}
        for (const setting of settingNames) {
            const property = states.find(state => aliases[setting].includes(state.name))
            try {
                const value = String(await camera[methods[setting][0]]())
                const choices = (property?.allowedValues ?? []).map(String).slice(0, 512)
                // Never invent writable choices when a body/transport does not advertise them.
                controls[setting] = { value, choices,
                    enabled: property?.enabled !== false &&
                        (property?.writable === true || property?.access === 'GetSet') && choices.length > 0 }
            } catch { /* Unsupported controls stay absent. */ }
        }
        entry.view.controls = controls
    }
    action(id: string, action: BenchAction, setting?: SettingName, value?: string): Promise<BenchState | MediaResult> {
        return this.runtime.runExclusive(id, async () => {
            const entry = this.entries.get(id)
            if (!entry) throw Error('Unknown camera; scan USB cameras first')
            const view = entry.view
            try {
                if (action !== 'stop' && action !== 'refresh' && view.recording !== 'idle')
                    throw Error('Stop and confirm the current recording before another camera operation')
                if (action === 'connect') {
                    if (!entry.camera) {
                        if (entry.ambiguous) throw Error('These cameras have no unique USB identity; connect one at a time')
                        const camera = this.adapter.create(entry.identity)
                        try { await camera.connect() }
                        catch (error) {
                            try { await camera.disconnect() } catch { /* Retain the connect failure. */ }
                            throw error
                        }
                        entry.camera = camera
                        view.connected = true
                    }
                    await this.read(entry)
                } else {
                    if (!entry.camera) throw Error('Connect the camera first')
                    const camera = entry.camera
                    if (action === 'disconnect') {
                        await camera.disconnect()
                        entry.camera = undefined
                        view.connected = false
                        view.controls = {}
                    } else if (action === 'refresh') {
                        if (view.recording === 'idle') await this.read(entry)
                    } else if (action === 'setting') {
                        if (!setting || !settingNames.includes(setting) || typeof value !== 'string')
                            throw Error('Choose a supported camera setting')
                        await this.read(entry)
                        const control = view.controls[setting]
                        if (!control?.enabled || !control.choices.includes(value))
                            throw Error('This value is not currently advertised and writable')
                        await camera[methods[setting][1]](value)
                        try {
                            await this.read(entry)
                            if (view.controls[setting]?.value !== value) throw Error('Camera readback differs from the requested value')
                        } catch (error) {
                            throw Error('The write completed but readback was not confirmed. Refresh before another write: ' + message(error))
                        }
                    } else if (action === 'frame' || action === 'photo') {
                        const result: { data?: Uint8Array; info?: { filename?: string } } = action === 'frame'
                            ? await camera.captureLiveView({ includeInfo: false, includeData: true })
                            : await camera.captureImage({ includeInfo: true, includeData: true, autofocus: false,
                                ...([0x054c, 0x04b0].includes(entry.identity.vendorId) ? { destination: 'memory' as const } : {}) })
                        const bytes = result.data
                        if (!bytes?.byteLength || bytes.byteLength > 128 * 1024 * 1024)
                            throw Error('Camera did not return media within the transfer limit')
                        view.error = undefined
                        return { bytes, filename: result.info?.filename || (action === 'frame' ? 'live-view.jpg' : 'photo.bin'),
                            contentType: bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
                                : bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71
                                    ? 'image/png' : 'application/octet-stream' }
                    } else if (action === 'start') {
                        if (!view.canRecord) throw Error('Recording is not implemented for this camera')
                        view.recording = 'uncertain'
                        await camera.startRecording()
                        view.recording = 'recording'
                    } else if (action === 'stop') {
                        if (view.recording === 'idle') throw Error('This host has no active recording to stop')
                        await camera.stopRecording()
                        view.recording = 'idle'
                    } else if (action === 'recover') {
                        // Link recovery verifies identity, then leaves the transport closed.
                        view.connected = false
                        try {
                            const recovery = await camera.recover({ allowPortReset: false })
                            if (!recovery.recovered) throw Error('Link could not recover the camera session')
                            await camera.connect()
                            view.connected = true
                            await this.read(entry)
                        } catch (error) {
                            try { await camera.disconnect(); entry.camera = undefined; view.connected = false; view.controls = {} }
                            catch { /* Keep the owned instance available for explicit cleanup. */ }
                            throw error
                        }
                    } else throw Error('Unsupported camera action')
                }
                view.error = undefined
                return this.state()
            } catch (error) {
                view.error = message(error)
                throw error
            }
        })
    }
    async close() {
        const errors: unknown[] = []
        for (const [id, entry] of this.entries) {
            try { await this.runtime.runExclusive(id, async () => {
                if (!entry.camera) return
                if (entry.view.recording !== 'idle') { await entry.camera.stopRecording(); entry.view.recording = 'idle' }
                await entry.camera.disconnect()
                entry.camera = undefined
                entry.view.connected = false
            }) } catch (error) { errors.push(error) }
        }
        if (errors.length) throw new AggregateError(errors, 'Some camera sessions could not be closed safely')
    }
}
