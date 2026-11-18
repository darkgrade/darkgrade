export const choices = {
    iso: ['auto', '100', '200', '400', '800', '1600', '3200'],
    aperture: ['f/2.8', 'f/4', 'f/5.6', 'f/8'],
    shutterSpeed: ['1/30', '1/60', '1/125', '1/250'],
    whiteBalance: ['auto', 'daylight', 'tungsten'],
} as const
export type Setting = keyof typeof choices
export type Scenario = 'ready' | 'offline' | 'busy' | 'battery'
export type DemoCamera = {
    label: string
    displayName: string
    selected: boolean
    health: { status: 'ready' | 'missing' | 'busy'; ptpResponsive: boolean }
    transport: { mode: 'usb' }
    battery: number
    settings: Record<Setting, string>
}
export type DemoTake = { id: number; seconds: number; cameras: string[]; simulated: true }

function initialCameras(): DemoCamera[] {
    return ['Cinema camera', 'Mirrorless camera', 'Hybrid camera'].map((displayName, index) => ({
        label: `demo-camera-${index + 1}`,
        displayName,
        selected: true,
        health: { status: 'ready', ptpResponsive: true },
        transport: { mode: 'usb' },
        battery: 86 - index * 9,
        settings: { iso: '400', aperture: 'f/4', shutterSpeed: '1/60', whiteBalance: 'daylight' },
    }))
}

/** Demo state has no transport, persistence or hardware integration. */
export class Demo {
    cameras = initialCameras()
    takes: DemoTake[] = []
    checking = false
    checked = false
    recording = false
    scenario: Scenario = 'ready'
    private generation = 0
    private started = 0
    private listeners = new Set<() => void>()
    constructor(private wait = () => new Promise<void>(resolve => setTimeout(resolve, 450)),
        private now = () => Date.now()) {}

    subscribe(listener: () => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }
    private notify() { for (const listener of this.listeners) listener() }
    private idle() {
        if (this.checking || this.recording) throw Error('Finish the current simulated operation first')
    }
    camera(label: string) {
        const camera = this.cameras.find(candidate => candidate.label === label)
        if (!camera) throw Error('Unknown demo camera')
        return camera
    }
    private ready(camera: DemoCamera) {
        if (camera.health.status !== 'ready') throw Error(`${camera.displayName} is ${camera.health.status === 'missing' ? 'offline' : 'busy'}`)
        if (camera.battery < 10) throw Error(`${camera.displayName} needs a charged battery`)
    }
    select(label: string, selected: boolean) {
        this.idle()
        this.camera(label).selected = selected
        this.checked = false
        this.notify()
    }
    setting(label: string, setting: Setting, value: string) {
        this.idle()
        const camera = this.camera(label)
        this.ready(camera)
        if (!Object.hasOwn(choices, setting) || !(choices[setting] as readonly string[]).includes(value))
            throw Error('Choose an advertised demo setting')
        camera.settings[setting] = value
        this.checked = false
        this.notify()
    }
    rename(label: string, name: string) {
        this.idle()
        if (!name.trim() || name.length > 80) throw Error('Use a camera name between 1 and 80 characters')
        this.camera(label).displayName = name.trim()
        this.notify()
    }
    async check() {
        this.idle()
        const selected = this.cameras.filter(camera => camera.selected)
        if (!selected.length) throw Error('Select at least one camera')
        this.checked = false
        this.checking = true
        const generation = this.generation
        this.notify()
        try {
            await this.wait()
            if (generation !== this.generation) return
            for (const camera of selected) this.ready(camera)
            this.checked = true
        } finally {
            if (generation === this.generation) {
                this.checking = false
                this.notify()
            }
        }
    }
    start() {
        this.idle()
        if (!this.checked) throw Error('Check the selected cameras before recording')
        for (const camera of this.cameras.filter(camera => camera.selected)) this.ready(camera)
        this.started = this.now()
        this.recording = true
        this.notify()
    }
    stop() {
        if (!this.recording) throw Error('No simulated take is recording')
        this.takes.push({ id: this.takes.length + 1, seconds: Math.max(0, (this.now() - this.started) / 1000),
            cameras: this.cameras.filter(camera => camera.selected).map(camera => camera.displayName), simulated: true })
        this.recording = false
        this.checked = false
        this.notify()
    }
    setScenario(scenario: Scenario) {
        this.idle()
        if (!['ready', 'offline', 'busy', 'battery'].includes(scenario)) throw Error('Unknown demo scenario')
        this.cameras = initialCameras()
        this.scenario = scenario
        if (scenario === 'offline') this.cameras[1].health = { status: 'missing', ptpResponsive: false }
        if (scenario === 'busy') this.cameras[1].health = { status: 'busy', ptpResponsive: true }
        if (scenario === 'battery') this.cameras[1].battery = 4
        this.checked = false
        this.notify()
    }
    reset() {
        this.generation++
        this.cameras = initialCameras()
        this.takes = []
        this.checking = this.checked = this.recording = false
        this.scenario = 'ready'
        this.notify()
    }
}
