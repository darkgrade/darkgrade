// bun run --cwd packages/slate camera:lease -- [--camera VID:PID[:SERIAL]] [--wait-minutes 30] [--purpose TEXT] <command...>
//
// Waits for exclusive use of a USB camera, stops the macOS camera daemons for as long as the
// command runs, runs it with SLATE_HARDWARE_TESTS=1, and always releases the lease. Each lease is
// a HardwareCoordinator claim keyed by the camera's USB vendor:product and serial number in a
// FileOwnershipStore under ~/.darkgrade/leases, so every checkout and worktree on this computer
// shares it: one camera is exclusive, different cameras run in parallel. Without --camera the
// command leases every attached camera. A lease whose processes are gone is free at once,
// including after `kill -9`.
import type { DiscoveredCamera } from '@camera/driver'
import { Camera } from '@camera/index'
import { FileOwnershipStore, type HardwareClaim } from '@runtime/file-ownership-store'
import { HardwareCoordinator } from '@runtime/ownership'
import { killMacCameraDaemons } from '@transport/usb/macos-camera-daemons'
import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hardwareTestEnvironmentVariable } from '@tests/setup/hardware'

const usage = 'Usage: bun run camera:lease -- [--camera VID:PID[:SERIAL]] [--wait-minutes 30] [--purpose TEXT] <command...>'
const daemonIntervalMilliseconds = 1000

export type LeasedCamera = Pick<DiscoveredCamera, 'vendorId' | 'productId' | 'serialNumber'>

const hexadecimal = (value: number) => value.toString(16).padStart(4, '0')

/** `vvvv:pppp:SERIAL`, or `vvvv:pppp` for a body that reports no serial number. */
export function cameraLabel(camera: LeasedCamera): string {
    return [hexadecimal(camera.vendorId), hexadecimal(camera.productId), camera.serialNumber].filter(Boolean).join(':')
}

export const cameraLeaseResource = (camera: LeasedCamera) => `usb-camera:${cameraLabel(camera)}`

/** Parses `VID:PID[:SERIAL]` in hexadecimal, as cameraLabel prints it. */
export function parseCameraSelector(selector: string): LeasedCamera {
    const [vendor, product, ...serial] = selector.split(':')
    const vendorId = Number.parseInt(vendor ?? '', 16)
    const productId = Number.parseInt(product ?? '', 16)
    if (!Number.isFinite(vendorId) || !Number.isFinite(productId)) throw new Error(`--camera ${selector} is not VID:PID[:SERIAL]\n${usage}`)
    return { vendorId, productId, ...(serial.length ? { serialNumber: serial.join(':') } : {}) }
}

function describeClaim(claim: HardwareClaim) {
    const since = Math.round((Date.now() - claim.claimedAt) / 1000)
    return `process ${claim.processId} for ${since} s (${claim.purpose})`
}

function studioRunning(): boolean {
    if (process.platform !== 'darwin') return false
    const result = spawnSync('pgrep', ['-f', 'Darkgrade Studio.app/Contents/MacOS|apps/studio/out/main'], {
        encoding: 'utf8',
    })
    return result.status === 0 && result.stdout.trim().length > 0
}

const store = () => new FileOwnershipStore()

/**
 * Runs `operation` while this process holds the leases of `cameras` (claimed in a fixed order, so
 * two processes leasing overlapping sets cannot deadlock) and the macOS camera daemons stay
 * stopped. `operation` receives the lease owner id, which child processes inherit.
 */
export async function withCameraLeases<T>(
    cameras: readonly LeasedCamera[],
    purpose: string,
    waitMinutes: number,
    operation: (owner: string | undefined) => Promise<T>
): Promise<T> {
    if (!cameras.length) throw new Error('No USB camera is attached to lease')
    if (studioRunning()) throw new Error('Darkgrade Studio is running and uses the camera; quit it before leasing')
    const ownership = store()
    const coordinator = new HardwareCoordinator(ownership)
    const resources = [...new Set(cameras.map(cameraLeaseResource))].sort()
    const heldByOthers = () => ownership.hardwareOwners().filter(claim => resources.includes(claim.resource) && claim.owner !== coordinator.owner)
    for (const holder of heldByOthers()) process.stderr.write(`camera:lease waiting: ${holder.resource} is held by ${describeClaim(holder)}\n`)
    const waitingReport = setInterval(() => {
        for (const holder of heldByOthers()) process.stderr.write(`camera:lease still waiting on ${holder.resource}: ${describeClaim(holder)}\n`)
    }, 30000)
    const claimFrom = async (index: number): Promise<T> => {
        if (index < resources.length)
            return coordinator.run(resources[index]!, purpose, () => claimFrom(index + 1), waitMinutes * 60000)
        clearInterval(waitingReport)
        await killMacCameraDaemons()
        const daemons = setInterval(() => void killMacCameraDaemons(), daemonIntervalMilliseconds)
        try {
            return await operation(coordinator.owner)
        } finally {
            clearInterval(daemons)
        }
    }
    try {
        return await claimFrom(0)
    } finally {
        clearInterval(waitingReport)
    }
}

function parseArguments(argumentList: string[]) {
    const remaining = argumentList[0] === '--' ? argumentList.slice(1) : [...argumentList]
    let waitMinutes = 30
    let purpose: string | undefined
    const cameras: LeasedCamera[] = []
    while (remaining[0]?.startsWith('--')) {
        const flag = remaining.shift()
        if (flag === '--') break
        const value = remaining.shift()
        if (flag === '--wait-minutes') waitMinutes = Number(value)
        else if (flag === '--purpose') purpose = value
        else if (flag === '--camera') cameras.push(parseCameraSelector(value ?? ''))
        else throw new Error(`Unknown option ${flag}\n${usage}`)
    }
    if (!remaining.length || !Number.isFinite(waitMinutes) || waitMinutes <= 0) throw new Error(usage)
    return { command: remaining, cameras, waitMinutes, purpose: purpose ?? remaining.join(' ') }
}

async function main() {
    const { command, cameras, waitMinutes, purpose } = parseArguments(process.argv.slice(2))
    const leased = cameras.length ? cameras : await Camera.discover()
    let child: ReturnType<typeof spawn> | undefined
    let interrupted: NodeJS.Signals | undefined
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
        process.on(signal, () => {
            interrupted = signal
            // Before the command starts nothing is held long: the claim belongs to this process.
            if (!child) process.exit(130)
            child.kill(signal)
        })

    const exitCode = await withCameraLeases(leased, purpose, waitMinutes, async owner => {
        process.stderr.write(`camera:lease acquired ${leased.map(cameraLabel).join(', ')}; running ${command.join(' ')}\n`)
        const [executable, ...argumentsList] = command
        child = spawn(executable!, argumentsList, {
            stdio: 'inherit',
            env: {
                ...process.env,
                [hardwareTestEnvironmentVariable]: '1',
                DARKGRADE_CAMERA_LEASE: owner,
                DARKGRADE_LEASED_CAMERAS: leased.map(cameraLabel).join(','),
            },
        })
        if (owner && child.pid) store().attachChildProcess(owner, child.pid)
        return new Promise<number>(resolve => {
            child!.once('error', error => {
                process.stderr.write(`camera:lease could not start the command: ${error.message}\n`)
                resolve(127)
            })
            child!.once('exit', (code, signal) => resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)))
        })
    })
    process.stderr.write(`camera:lease released${interrupted ? ` after ${interrupted}` : ''}\n`)
    process.exit(exitCode)
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
    main().catch(error => {
        process.stderr.write(`camera:lease: ${error instanceof Error ? error.message : String(error)}\n`)
        process.exit(1)
    })
