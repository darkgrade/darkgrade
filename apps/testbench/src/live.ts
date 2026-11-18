import { Demo, type DemoCamera } from './demo'
import type { BenchAction, BenchState, SettingName } from './contracts'

/** This client talks only to the same-origin local USB host. It never opens USB in the browser. */
export class USBBench extends Demo {
    override cameras: DemoCamera[] = []
    source: BenchState['source'] = 'hardware'
    private token: Promise<string> | undefined
    private startedAt = 0
    private async request(path: string, body?: unknown): Promise<Response> {
        if (!/^\/api\/(?:state|scan|cameras\/[a-f0-9-]{36}\/action)$/.test(path))
            throw Error('Invalid local camera API path')
        this.token ??= fetch('/api/session', { headers: { 'X-Testbench-Action': '1' } }).then(async response => {
            if (!response.ok || !response.headers.get('Content-Type')?.includes('application/json'))
                throw Error('Start the local USB host with bun run testbench')
            return (await response.json()).token as string
        }).catch(error => { this.token = undefined; throw error })
        const response = await fetch(path, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { 'X-Testbench-Action': '1', Authorization: 'Bearer ' + await this.token,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error',
        })
        if (!response.ok) {
            const failure = await response.json()
            if (failure.state) this.apply(failure.state)
            throw Error(failure.error || 'Camera request failed; inspect the host before repeating a write')
        }
        return response
    }
    private apply(state: BenchState) {
        this.source = state.source
        const previous = this.cameras
        this.cameras = state.cameras.map(camera => {
            const old = previous.find(candidate => candidate.label === camera.id)
            return {
                label: camera.id, displayName: old?.displayName ?? camera.name, selected: old?.selected ?? true,
                connected: camera.connected, error: camera.error, controls: camera.controls, previewUrl: old?.previewUrl,
                recordingState: camera.recording,
                canRecord: camera.canRecord,
                health: { status: camera.error ? 'busy' as const : camera.connected ? 'ready' as const : 'missing' as const,
                    ptpResponsive: camera.connected },
                transport: { mode: 'usb' as const }, battery: 100,
                settings: { iso: camera.controls.iso?.value ?? '', aperture: camera.controls.aperture?.value ?? '',
                    shutterSpeed: camera.controls.shutterSpeed?.value ?? '', whiteBalance: camera.controls.whiteBalance?.value ?? '' },
            }
        })
        this.recording = this.cameras.some(camera => camera.recordingState !== 'idle')
        this.notify()
    }
    private async command(id: string, action: BenchAction, setting?: SettingName, value?: string) {
        const response = await this.request(`/api/cameras/${encodeURIComponent(id)}/action`, { action,
            ...(setting ? { setting, value } : {}) })
        if (action !== 'frame' && action !== 'photo') this.apply(await response.json())
        return response
    }
    async restoreHostState() {
        this.checking = true; this.notify()
        try { this.apply(await (await this.request('/api/state')).json()) }
        finally { this.checking = false; this.notify() }
    }
    async scan() {
        this.idle()
        this.checking = true; this.notify()
        try { this.apply(await (await this.request('/api/scan', {})).json()); this.checked = false }
        finally { this.checking = false; this.notify() }
    }
    override async check() {
        this.idle()
        const selected = this.cameras.filter(camera => camera.selected)
        if (!selected.length) throw Error('Scan USB cameras and select at least one camera')
        this.checking = true; this.checked = false; this.notify()
        const errors: string[] = []
        try {
            for (const camera of selected)
                try { await this.command(camera.label, 'connect') } catch (error) { errors.push(String(error)) }
            if (errors.length) throw Error(errors.join('; '))
            this.checked = true
        } finally { this.checking = false; this.notify() }
    }
    override async setting(id: string, setting: SettingName, value: string) {
        this.idle(); this.checking = true; this.notify()
        try { await this.command(id, 'setting', setting, value); this.checked = false }
        finally { this.checking = false; this.notify() }
    }
    async media(id: string, action: 'frame' | 'photo') {
        this.idle(); this.checking = true; this.notify()
        try {
            const response = await this.command(id, action)
            const blob = await response.blob()
            this.apply(await (await this.request('/api/state')).json())
            const url = URL.createObjectURL(blob)
            if (action === 'frame') {
                const camera = this.camera(id)
                if (camera.previewUrl) URL.revokeObjectURL(camera.previewUrl)
                camera.previewUrl = url
            } else {
                const link = document.createElement('a')
                link.href = url
                const encoded = response.headers.get('Content-Disposition')?.match(/filename\*=UTF-8''(.+)/)?.[1]
                link.download = encoded ? decodeURIComponent(encoded) : 'camera-photo'
                link.click()
                setTimeout(() => URL.revokeObjectURL(url), 1000)
            }
        } finally { this.checking = false; this.notify() }
    }
    override async start() {
        this.idle()
        if (!this.checked) throw Error('Connect and check the selected cameras first')
        this.checking = true; this.startedAt = Date.now(); this.notify()
        const started: string[] = []
        try {
            for (const camera of this.cameras.filter(camera => camera.selected)) {
                await this.command(camera.label, 'start')
                started.push(camera.label)
            }
        } catch (error) {
            // Stop cameras this host started; never retry an ambiguous start.
            for (const id of started) await this.command(id, 'stop').catch(() => {})
            throw error
        } finally { this.checking = false; this.notify() }
    }
    override async stop() {
        if (this.checking) throw Error('Wait for the current camera operation')
        const active = this.cameras.filter(camera => camera.recordingState !== 'idle')
        this.checking = true; this.notify()
        const errors: string[] = []
        try {
            for (const camera of active)
                try { await this.command(camera.label, 'stop') } catch (error) { errors.push(String(error)) }
            if (errors.length) throw Error(errors.join('; '))
            this.takes.push({ id: this.takes.length + 1, ...(this.startedAt ? { seconds: (Date.now() - this.startedAt) / 1000 } : {}),
                cameras: active.map(camera => camera.displayName), simulated: false })
            this.checked = false
        } finally { this.checking = false; this.notify() }
    }
    async refresh(id: string) {
        if (this.checking) throw Error('Wait for the current camera operation')
        await this.command(id, 'refresh')
    }
    async recover(id: string) {
        this.idle(); this.checking = true; this.notify()
        try { await this.command(id, 'recover') }
        finally { this.checking = false; this.notify() }
    }
    override async reset() {
        this.idle()
        for (const camera of this.cameras.filter(camera => camera.connected)) await this.command(camera.label, 'disconnect')
        for (const camera of this.cameras) if (camera.previewUrl) URL.revokeObjectURL(camera.previewUrl)
        this.cameras = []; this.takes = []; this.checked = false; this.notify()
    }
}
