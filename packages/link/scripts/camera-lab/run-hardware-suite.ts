/**
 * Runs the camera compatibility capabilities against a physical camera from camera-lab/cameras.lab.json
 * and writes a one-row support matrix with fidelity "hardware".
 *
 *   bun run lab:hardware -- --camera nikon-z6-iii [--output test-results/camera-lab/nikon-z6-iii.json]
 *
 * The camera's captured profile supplies the values darkgrade must decode (model, observed property
 * values). Captured traffic is never replayed on hardware, and a changed property is restored before
 * the capability passes. Exits 1 when any capability fails, 2 when the camera cannot be selected.
 */
import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import { CAPABILITIES, evaluateCapabilities, type SimulatedCamera } from '@scripts/camera-profiles/camera-capabilities'
import { countStatuses, type SupportMatrix, type SupportMatrixRow } from '@scripts/camera-profiles/support-matrix'
import { parseCode } from '@transport/simulated/camera-profile'
import { USBTransport } from '@transport/usb/usb-transport'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadRegistry, loadRegistryProfile, packageDirectory, usbPair, validateRegistry } from './camera-registry'
import { ResponseRecordingTransport } from './response-recording-transport'

const HARDWARE_TIMEOUT_MILLISECONDS = 30_000
const DISCONNECT_TIMEOUT_MILLISECONDS = 5_000
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

const registry = loadRegistry()
const problems = validateRegistry(registry)
if (problems.length) fail(`cameras.lab.json is invalid:\n  ${problems.join('\n  ')}`)
const cameraId = valueAfter('--camera') ?? process.env.DARKGRADE_LAB_CAMERA
const entry = registry.cameras.find(camera => camera.id === cameraId)
if (!entry) fail(`Unknown lab camera "${cameraId ?? ''}"; pass --camera <id> from cameras.lab.json`)
if (entry.connection !== 'usb' || !entry.usb) fail(`${entry.id}: only the usb connection is run by the lab tier`)
const output = path.resolve(
    valueAfter('--output') ?? path.join(packageDirectory, 'test-results/camera-lab', `${entry.id}.json`)
)

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
    device: { usb: { filters: [{ vendorId, productId: parseCode(entry.usb.productId), ...PTP_STILL_IMAGE_CLASS }] } },
    timeoutMilliseconds: HARDWARE_TIMEOUT_MILLISECONDS,
}

const startedAt = Date.now()
const results = await evaluateCapabilities(target)
const firmware = await readFirmware(target).catch(() => undefined)
await Promise.race([
    target.camera.disconnect().catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, DISCONNECT_TIMEOUT_MILLISECONDS)),
])

const row: SupportMatrixRow = {
    profile: profile.id,
    path: entry.profile,
    manufacturer: entry.manufacturer,
    line: entry.line,
    model: entry.model,
    fidelity: 'hardware',
    ...((firmware || entry.firmware) && { firmware: firmware || entry.firmware! }),
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

/** The firmware the camera reports in DeviceInfo, when a session was established. */
async function readFirmware(camera: SimulatedCamera): Promise<string | undefined> {
    if (results.session?.status !== 'pass') return undefined
    const instance = camera.camera.getInstance()
    const response = await instance.send(instance.registry.operations.GetDeviceInfo, {})
    return response.data?.deviceVersion || undefined
}
