import { connectionHelp, usbId } from '@cli/camera-selection'
import { attachedCameras, cameraName, defaultCameraDiscovery, type CameraDiscovery } from '@cli/cameras'
import type { Terminal } from '@cli/terminal'
import { settingsDirectory, sharedSettings } from '@contribute/settings'
import { homedir } from 'node:os'

export interface DoctorCheck {
    name: string
    /** 'warning' leaves the exit status at 0: nothing is broken, but nothing could be confirmed either. */
    outcome: 'passed' | 'warning' | 'failed'
    detail: string
    /** What to do about it, when the check did not pass. */
    remedy?: string
}

export interface DoctorEnvironment {
    nodeVersion: string
    platform: string
    architecture: string
    /** Rejects when the native USB driver cannot be loaded. */
    cameraDiscovery(): Promise<CameraDiscovery>
}

const minimumNode = [22, 18] as const

const defaultEnvironment = (): DoctorEnvironment => ({
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    cameraDiscovery: defaultCameraDiscovery,
})

/** The home folder is written as ~ so the report can be pasted into an issue without a user name. */
const withoutHome = (path: string) => (path.startsWith(homedir()) ? '~' + path.slice(homedir().length) : path)

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

export async function doctorChecks(environment: DoctorEnvironment = defaultEnvironment()): Promise<DoctorCheck[]> {
    const checks: DoctorCheck[] = []
    const [major, minor] = environment.nodeVersion.split('.').map(Number)
    const nodeSupported = major > minimumNode[0] || (major === minimumNode[0] && minor >= minimumNode[1])
    checks.push({
        name: 'node',
        outcome: nodeSupported ? 'passed' : 'failed',
        detail: `Node ${environment.nodeVersion} on ${environment.platform} ${environment.architecture}`,
        ...(!nodeSupported && { remedy: `Install Node ${minimumNode.join('.')} or newer.` }),
    })
    try {
        const saved = await sharedSettings().read()
        if (!saved) throw new Error('the settings file could not be read')
        const detail = `Settings in ${withoutHome(settingsDirectory())}; sharing is ${saved.enabled ? 'on' : 'off'}`
        checks.push({ name: 'settings', outcome: 'passed', detail })
    } catch (error) {
        checks.push({
            name: 'settings',
            outcome: 'failed',
            detail: `Settings in ${withoutHome(settingsDirectory())} are unavailable: ${reason(error)}`,
            remedy: 'Make the folder writable, or point DARKGRADE_HOME at one that is.',
        })
    }
    let discovery: CameraDiscovery
    try {
        discovery = await environment.cameraDiscovery()
        checks.push({ name: 'usb-driver', outcome: 'passed', detail: 'USB driver loaded' })
    } catch (error) {
        checks.push({
            name: 'usb-driver',
            outcome: 'failed',
            detail: `USB driver did not load: ${reason(error)}`,
            remedy: 'Reinstall darkgrade so the usb module is built for this Node version and platform.',
        })
        return checks
    }
    try {
        const cameras = await attachedCameras(discovery)
        for (const device of cameras)
            checks.push(
                device.state === 'ready'
                    ? { name: 'camera', outcome: 'passed', detail: `${cameraName(device)} (${usbId(device)}) is ready` }
                    : {
                          name: 'camera',
                          // A camera maker's other products (a card reader, a remote) enumerate the same way.
                          outcome: 'warning',
                          detail: `${cameraName(device)} (${usbId(device)}) is attached but not in PTP mode`,
                          remedy: connectionHelp,
                      }
            )
        if (!cameras.length)
            checks.push({ name: 'camera', outcome: 'warning', detail: 'No camera found', remedy: connectionHelp })
    } catch (error) {
        checks.push({
            name: 'camera',
            outcome: 'failed',
            detail: `USB devices could not be listed: ${reason(error)}`,
            remedy: 'Close other camera software and reconnect the cable.',
        })
    }
    return checks
}

/** `darkgrade doctor`: every check, what failed, and what to do about it. */
export async function runDoctorCommand(
    options: { json: boolean; version?: string },
    terminal: Terminal,
    environment?: DoctorEnvironment
): Promise<number> {
    const progress = terminal.progress()
    if (terminal.animated) progress.update('Checking this computer and its cameras…')
    let checks: DoctorCheck[]
    try {
        checks = await doctorChecks(environment)
    } finally {
        progress.stop()
    }
    const failed = checks.filter(check => check.outcome === 'failed').length
    if (options.json) {
        terminal.print(JSON.stringify({ version: options.version ?? null, healthy: !failed, checks }))
        return failed ? 1 : 0
    }
    const { out } = terminal
    const mark = { passed: out.green('✓'), warning: out.yellow('!'), failed: out.red('✗') }
    terminal.print(`${out.bold('darkgrade')} ${options.version ?? ''}`.trimEnd() + '\n')
    for (const check of checks) {
        terminal.print(`${mark[check.outcome]} ${check.detail}`)
        if (check.remedy) terminal.print(out.dim(check.remedy.replace(/^/gm, '    ')))
    }
    const cameraReady = checks.some(check => check.name === 'camera' && check.outcome === 'passed')
    const verdict = failed ? out.red(`${failed} ${failed === 1 ? 'problem' : 'problems'} found.`)
        : !cameraReady ? 'Nothing is broken, but no camera is ready. Connect one and run this again.'
        : out.green('Everything is in place.') + ' Next: darkgrade telemetry benchmark'
    terminal.print('\n' + verdict)
    return failed ? 1 : 0
}
