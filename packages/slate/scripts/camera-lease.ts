// bun run --cwd packages/slate camera:lease -- [--wait-minutes 30] [--purpose TEXT] <command...>
//
// Waits for exclusive use of the attached USB camera, stops the macOS camera daemons for as long
// as the command runs, runs it with SLATE_HARDWARE_TESTS=1, and always releases the lease. The
// lease is a HardwareCoordinator claim in a FileOwnershipStore under ~/.darkgrade/leases, so every
// checkout and worktree on this computer shares it. A lease whose processes are gone is free at
// once, including after `kill -9`.
import { FileOwnershipStore, type HardwareClaim } from '@runtime/file-ownership-store'
import { HardwareCoordinator } from '@runtime/ownership'
import { killMacCameraDaemons } from '@transport/usb/macos-camera-daemons'
import { spawn, spawnSync } from 'node:child_process'
import { constants } from 'node:os'
import { hardwareTestEnvironmentVariable } from '@tests/setup/hardware'

export const attachedCameraResource = 'attached-usb-camera'
const usage = 'Usage: bun run camera:lease -- [--wait-minutes 30] [--purpose TEXT] <command...>'
const daemonIntervalMilliseconds = 1000

function parseArguments(argumentList: string[]) {
    const remaining = argumentList[0] === '--' ? argumentList.slice(1) : [...argumentList]
    let waitMinutes = 30
    let purpose: string | undefined
    while (remaining[0]?.startsWith('--')) {
        const flag = remaining.shift()
        if (flag === '--') break
        const value = remaining.shift()
        if (flag === '--wait-minutes') waitMinutes = Number(value)
        else if (flag === '--purpose') purpose = value
        else throw new Error(`Unknown option ${flag}\n${usage}`)
    }
    if (!remaining.length || !Number.isFinite(waitMinutes) || waitMinutes <= 0) throw new Error(usage)
    return { command: remaining, waitMinutes, purpose: purpose ?? remaining.join(' ') }
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

async function main() {
    const { command, waitMinutes, purpose } = parseArguments(process.argv.slice(2))
    if (studioRunning()) throw new Error('Darkgrade Studio is running and uses the camera; quit it before leasing')
    const store = new FileOwnershipStore()
    const coordinator = new HardwareCoordinator(store)
    const holder = store.hardwareOwners().find(claim => claim.resource === attachedCameraResource)
    if (holder) process.stderr.write(`camera:lease waiting: the camera is held by ${describeClaim(holder)}\n`)
    const waitingReport = setInterval(() => {
        const current = store.hardwareOwners().find(claim => claim.resource === attachedCameraResource)
        if (current && !coordinator.owner) process.stderr.write(`camera:lease still waiting on ${describeClaim(current)}\n`)
    }, 30000)

    let child: ReturnType<typeof spawn> | undefined
    let interrupted: NodeJS.Signals | undefined
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
        process.on(signal, () => {
            interrupted = signal
            // Before the command starts nothing is held long: the claim belongs to this process.
            if (!child) process.exit(130)
            child.kill(signal)
        })

    const exitCode = await coordinator.run(
        attachedCameraResource,
        purpose,
        async () => {
            clearInterval(waitingReport)
            const owner = coordinator.owner
            await killMacCameraDaemons()
            const daemons = setInterval(() => void killMacCameraDaemons(), daemonIntervalMilliseconds)
            process.stderr.write(`camera:lease acquired; running ${command.join(' ')}\n`)
            try {
                const [executable, ...argumentsList] = command
                child = spawn(executable!, argumentsList, {
                    stdio: 'inherit',
                    env: { ...process.env, [hardwareTestEnvironmentVariable]: '1', DARKGRADE_CAMERA_LEASE: owner },
                })
                if (owner && child.pid) store.attachChildProcess(owner, child.pid)
                return await new Promise<number>(resolve => {
                    child!.once('error', error => {
                        process.stderr.write(`camera:lease could not start the command: ${error.message}\n`)
                        resolve(127)
                    })
                    child!.once('exit', (code, signal) => resolve(code ?? 128 + (signal ? constants.signals[signal] : 0)))
                })
            } finally {
                clearInterval(daemons)
            }
        },
        waitMinutes * 60000
    )
    process.stderr.write(`camera:lease released${interrupted ? ` after ${interrupted}` : ''}\n`)
    process.exit(exitCode)
}

main().catch(error => {
    process.stderr.write(`camera:lease: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
})
