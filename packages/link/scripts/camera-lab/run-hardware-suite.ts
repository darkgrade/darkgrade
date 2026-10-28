/** Run read-only hardware checks under the deployed bench's ownership and camera lock. */
import {
    assertBenchAvailable,
    assertNoActiveCardTake,
    benchTool,
    type BenchStatus,
} from '@scripts/camera-lab/bench-ownership'
import { loadRegistry, packageDirectory, validateRegistry } from '@scripts/camera-lab/camera-registry'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const argumentsList = process.argv.slice(2)
const cameraFlag = argumentsList.indexOf('--camera')
const cameraId = (cameraFlag >= 0 ? argumentsList[cameraFlag + 1] : undefined) ?? process.env.DARKGRADE_LAB_CAMERA
const registry = loadRegistry()
const problems = validateRegistry(registry)
if (problems.length) throw new Error(problems.join('\n'))
const entry = registry.cameras.find(camera => camera.id === cameraId)
if (!entry?.enabled || !entry.usb || !entry.benchLabel || entry.connection !== 'usb')
    throw new Error('Choose an enabled USB camera with --camera <registry id>')
const outputFlag = argumentsList.indexOf('--output')
const output = path.resolve(
    outputFlag >= 0
        ? argumentsList[outputFlag + 1]
        : path.join(packageDirectory, 'test-results/camera-lab', `${entry.id}.json`)
)
const pendingOutput = `${output}.pending-${process.pid}`
const workerArguments =
    outputFlag >= 0
        ? argumentsList.filter((_, index) => index !== outputFlag && index !== outputFlag + 1)
        : [...argumentsList]
workerArguments.push('--output', pendingOutput)
rmSync(output, { force: true })
const benchDirectory = process.env.DARKGRADE_TESTBENCH_DIR
if (
    !benchDirectory ||
    !path.isAbsolute(benchDirectory) ||
    !existsSync(path.join(benchDirectory, 'src/hardware-coordinator.ts'))
)
    throw new Error(
        'Set DARKGRADE_TESTBENCH_DIR to the deployed bench checkout with shared HardwareCoordinator support; no camera operation attempted'
    )

assertBenchAvailable(await benchTool<BenchStatus>('bench_status', {}), entry)
const loadBenchModule = (filename: string) => import(pathToFileURL(path.join(benchDirectory, 'src', filename)).href)
const [{ BenchControlPlane }, { HardwareCoordinator }] = await Promise.all([
    loadBenchModule('control-plane.ts'),
    loadBenchModule('hardware-coordinator.ts'),
])
const controlPlane = new BenchControlPlane({
    repositoryRoot: benchDirectory,
    darkgradeRepository: path.resolve(packageDirectory, '../..'),
    automaticAttachmentProbes: false,
})
const coordinator = new HardwareCoordinator(controlPlane.stateDatabase)
let workerExitCode = 1
try {
    await coordinator.run(
        `camera:${entry.benchLabel}`,
        'Read-only camera simulation evidence checks',
        async () => {
            assertBenchAvailable(await benchTool<BenchStatus>('bench_status', {}), entry, coordinator.owner)
            assertNoActiveCardTake(controlPlane.stateDatabase.getSetting('video-take:active'), entry.benchLabel!)
            const job = await benchTool<{ id: string }>('agent_job_start', {
                camera: entry.benchLabel,
                repositoryPath: path.resolve(packageDirectory, '../..'),
                agent: 'camera-control',
            })
            let succeeded = false
            let heartbeatError: unknown
            let activeChild: ReturnType<typeof spawn> | undefined
            const stopChild = (signal: NodeJS.Signals = 'SIGTERM') => {
                if (!activeChild?.pid) return
                try {
                    process.kill(-activeChild.pid, signal)
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
                }
            }
            const heartbeat = setInterval(() => {
                void benchTool('agent_job_heartbeat', { jobId: job.id }).catch(error => {
                    heartbeatError = error
                    stopChild()
                })
            }, 20_000)
            try {
                const lockDirectory = '/var/tmp/darkgrade-testbench/locks'
                mkdirSync(lockDirectory, { recursive: true })
                const lockFile = path.join(lockDirectory, `${entry.benchLabel!.replace(/[^a-zA-Z0-9_.-]/g, '_')}.lock`)
                activeChild = spawn(
                    'flock',
                    [
                        '--no-fork',
                        '-E',
                        '75',
                        '-w',
                        '1',
                        lockFile,
                        process.execPath,
                        'run',
                        path.join(packageDirectory, 'scripts/camera-lab/hardware-suite-worker.ts'),
                        ...workerArguments,
                    ],
                    {
                        stdio: 'inherit',
                        detached: true,
                        env: { ...process.env, DARKGRADE_LAB_GUARDED_WORKER: String(process.pid) },
                    }
                )
                const child = activeChild
                let timedOut = false
                const terminate = () => {
                    timedOut = true
                    stopChild()
                }
                const watchdog = setTimeout(terminate, 120_000)
                const forceStop = setTimeout(() => stopChild('SIGKILL'), 130_000)
                process.once('SIGTERM', terminate)
                process.once('SIGINT', terminate)
                try {
                    const exitCode = await new Promise<number>((resolve, reject) => {
                        child.once('error', reject)
                        child.once('exit', code => resolve(code ?? 1))
                    })
                    if (heartbeatError) throw heartbeatError
                    if (timedOut)
                        throw new Error('Hardware worker interrupted; USB worker exited before ownership was released')
                    if (![0, 1].includes(exitCode) || !existsSync(pendingOutput))
                        throw new Error(
                            `Hardware worker exited ${exitCode} without completed results; no automatic recovery attempted`
                        )
                    workerExitCode = exitCode
                    succeeded = exitCode === 0
                } finally {
                    clearTimeout(watchdog)
                    clearTimeout(forceStop)
                    process.removeListener('SIGTERM', terminate)
                    process.removeListener('SIGINT', terminate)
                    activeChild = undefined
                }
            } finally {
                clearInterval(heartbeat)
                await benchTool('agent_job_finish', {
                    jobId: job.id,
                    succeeded,
                    summary: 'Read-only lab identity/session checks; no settings, capture, power or recovery actions',
                })
            }
        },
        0
    )
    renameSync(pendingOutput, output)
    process.exitCode = workerExitCode
} finally {
    rmSync(pendingOutput, { force: true })
    controlPlane.stateDatabase.close()
}
