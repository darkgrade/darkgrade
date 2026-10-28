/** Internal worker: read-only session and DeviceInfo checks while its parent holds bench ownership. */
import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { assertGuardedWorker, benchTool, liveCameraSerial, type BenchStatus } from '@scripts/camera-lab/bench-ownership'
import {
    loadRegistry,
    loadRegistryProfile,
    packageDirectory,
    usbPair,
    validateRegistry,
} from '@scripts/camera-lab/camera-registry'
import { runReadOnlyHardwareChecks } from '@scripts/camera-lab/read-only-hardware-checks'
import { ResponseRecordingTransport } from '@scripts/camera-lab/response-recording-transport'
import { CAPABILITIES, type SimulatedCamera } from '@scripts/camera-profiles/camera-capabilities'
import { countStatuses, type SupportMatrix, type SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { parseCode } from '@transport/simulated/camera-profile'
import { USBTransport } from '@transport/usb/usb-transport'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const HARDWARE_TIMEOUT_MILLISECONDS = 30_000
const PTP_STILL_IMAGE_CLASS = { classCode: 0x06, subclassCode: 0x01 }

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}

function fail(message: string): never {
    console.error(message)
    process.exit(2)
}

if (!process.env.DARKGRADE_LAB_GUARDED_WORKER) fail('Run lab:hardware through the bench ownership adapter')

const registry = loadRegistry()
const problems = validateRegistry(registry)
if (problems.length) fail(`cameras.lab.json is invalid:\n  ${problems.join('\n  ')}`)
const cameraId = valueAfter('--camera') ?? process.env.DARKGRADE_LAB_CAMERA
const entry = registry.cameras.find(camera => camera.id === cameraId)
if (!entry?.enabled) fail(`Unknown or disabled lab camera "${cameraId ?? ''}"; pass an enabled --camera <id>`)
if (entry.connection !== 'usb' || !entry.usb) fail(`${entry.id}: only the usb connection is run by the lab tier`)
const output = path.resolve(
    valueAfter('--output') ?? path.join(packageDirectory, 'test-results/camera-lab', `${entry.id}.json`)
)

const status = await benchTool<BenchStatus>('bench_status', {})
assertGuardedWorker(
    status,
    entry,
    {
        parentProcessId: Number(process.env.DARKGRADE_LAB_GUARDED_WORKER),
        owner: process.env.DARKGRADE_LAB_HARDWARE_OWNER ?? '',
        jobId: process.env.DARKGRADE_LAB_JOB_ID ?? '',
    },
    process.ppid
)
const serialNumber = liveCameraSerial(status, entry.benchLabel!)
const profile = loadRegistryProfile(entry)
const logger = new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
const transport = new ResponseRecordingTransport(new USBTransport(logger))
const vendorId = parseCode(entry.usb.vendorId)
const target: SimulatedCamera = {
    profile,
    camera: new Camera({
        transport,
        vendorId,
        logger: { renderInTerminal: false, captureConsole: false, expanded: false },
    }),
    transport,
    tier: 'hardware',
    device: {
        usb: {
            filters: [
                {
                    vendorId,
                    productId: parseCode(entry.usb.productId),
                    ...(serialNumber && { serialNumber }),
                    ...PTP_STILL_IMAGE_CLASS,
                },
            ],
        },
    },
    timeoutMilliseconds: HARDWARE_TIMEOUT_MILLISECONDS,
}

const startedAt = Date.now()
let stopping = false
const stop = () => {
    stopping = true
}
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
let abandonedStop: ReturnType<typeof setTimeout> | undefined
const parentWatch = setInterval(() => {
    if (process.ppid === Number(process.env.DARKGRADE_LAB_GUARDED_WORKER) || abandonedStop) return
    stopping = true
    abandonedStop = setTimeout(() => process.exit(2), 10_000)
}, 1_000)
let results: Awaited<ReturnType<typeof runReadOnlyHardwareChecks>>
try {
    results = await runReadOnlyHardwareChecks(target, () => stopping)
} finally {
    clearInterval(parentWatch)
    clearTimeout(abandonedStop)
    process.removeListener('SIGTERM', stop)
    process.removeListener('SIGINT', stop)
}
if (stopping)
    throw new Error('Hardware worker interrupted after draining the current operation and closing its session')

const row: SupportMatrixRow = {
    profile: profile.id,
    path: entry.profile,
    manufacturer: entry.manufacturer,
    line: entry.line,
    model: target.verifiedDeviceInfo?.model ?? entry.model,
    fidelity: 'hardware',
    ...(target.verifiedDeviceInfo?.deviceVersion && { firmware: target.verifiedDeviceInfo.deviceVersion }),
    ...(profile.catalog && { catalogLine: profile.catalog.line }),
    usb: [usbPair(entry.usb.vendorId, entry.usb.productId)],
    labCamera: entry.id,
    ...(entry.host && { host: entry.host }),
    quirks: { total: 0, simulated: 0, unverified: 0 },
    results,
}
const matrix: SupportMatrix = {
    generatedAt: new Date().toISOString(),
    ...(process.env.GITHUB_SHA && { revision: process.env.GITHUB_SHA.slice(0, 12) }),
    capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
    rows: [row],
    lines: [],
    totals: { hardware: countStatuses([row]) },
}
mkdirSync(path.dirname(output), { recursive: true })
writeFileSync(output, `${JSON.stringify(matrix, null, 2)}\n`)

for (const capability of CAPABILITIES) {
    const result = results[capability.id]
    console.log(`${capability.label.padEnd(24)} ${result.status.padEnd(12)} ${result.detail}`)
}
console.log(
    `${entry.id}: ${((Date.now() - startedAt) / 1000).toFixed(1)} s; wrote ${path.relative(process.cwd(), output)}`
)
process.exit(Object.values(results).some(result => result.status === 'fail') ? 1 : 0)
