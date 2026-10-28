/**
 * Software-only fixture runner for compatibility publication and progress tests.
 * Physical cameras must use compat:hardware, which delegates to the guarded bench adapter.
 */
import { Camera } from '@camera/index'
import { usbPair, type CameraRegistry, type LabCamera } from '@scripts/camera-lab/camera-registry'
import { runReadOnlyHardwareChecks } from '@scripts/camera-lab/read-only-hardware-checks'
import { ResponseRecordingTransport } from '@scripts/camera-lab/response-recording-transport'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { SimulatedTransport } from '@transport/simulated/simulated-transport'
import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { CAPABILITIES, type CameraConnection, type SimulatedCamera } from './camera-capabilities'
import { packageDirectory, ProgressLog, rowKey } from './compat-progress'
import { countStatuses, type SupportMatrix, type SupportMatrixRow } from './support-matrix'

const HARDWARE_TIMEOUT_MILLISECONDS = 30_000

export const hardwareResultsDirectory = path.join(packageDirectory, 'test-results/camera-lab')

/** Resolve only an enabled deployed bench mapping; a documented profile cannot authorize hardware access. */
export function resolveGuardedLabCamera(
    registry: CameraRegistry,
    selection: { usb?: string; profile?: string; ip?: string }
): LabCamera {
    if (selection.ip)
        throw new Error('PTP/IP hardware execution has no guarded bench adapter; use deployed bench MCP controls')
    if (!selection.usb || !/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(selection.usb))
        throw new Error('Pass --usb vvvv:pppp for an enabled bench camera')
    const camera = registry.cameras.find(
        camera =>
            camera.enabled &&
            camera.connection === 'usb' &&
            camera.usb &&
            usbPair(camera.usb.vendorId, camera.usb.productId) === selection.usb
    )
    if (!camera)
        throw new Error(
            'USB identity has no enabled guarded bench mapping; import a sanitized capture for simulation instead'
        )
    if (selection.profile && selection.profile !== path.basename(camera.profile, '.json'))
        throw new Error('Selected profile differs from the guarded bench camera profile')
    return camera
}

export interface StandaloneRunOptions {
    profile: CameraProfile
    profilePath: string
    /** Explicit simulated transport; raw USB/IP access is refused at runtime. */
    transport: SimulatedTransport
    connection: CameraConnection
    device?: DeviceDescriptor
    vendorId?: number
    usb?: string[]
    host?: string
    timeoutMilliseconds?: number
    runsDirectory?: string
    resultsDirectory?: string
}

export interface StandaloneRunResult {
    row: SupportMatrixRow
    matrixFile: string
    runFile?: string
}

/** The one-row matrix file name for a profile and transport. */
export function hardwareMatrixName(profileId: string, connection: CameraConnection): string {
    return connection === 'ptp-ip' ? `${profileId}.ptp-ip.json` : `${profileId}.json`
}

export async function runStandalone(options: StandaloneRunOptions): Promise<StandaloneRunResult> {
    const { profile, connection } = options
    if (!(options.transport instanceof SimulatedTransport))
        throw new Error('Physical camera execution requires compat:hardware and the deployed guarded bench adapter')
    const fidelity = profile.provenance.fidelity
    const transport = new ResponseRecordingTransport(options.transport)
    const target: SimulatedCamera = {
        profile,
        camera: new Camera({
            transport,
            vendorId: options.vendorId,
            logger: { renderInTerminal: false, captureConsole: false, expanded: false },
        }),
        transport,
        tier: 'simulated',
        connection,
        ...(options.device && { device: options.device }),
        timeoutMilliseconds: options.timeoutMilliseconds ?? HARDWARE_TIMEOUT_MILLISECONDS,
    }
    const key = rowKey({ fidelity, transport: connection, profile: profile.id })
    const host = options.host ?? hostname()
    const log = ProgressLog.start({
        source: 'simulation',
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows: [
            {
                key,
                profile: profile.id,
                path: options.profilePath,
                manufacturer: profile.manufacturer,
                line: profile.line,
                ...(profile.catalog && { catalogLine: profile.catalog.line }),
                model: profile.model,
                fidelity,
                transport: connection,
                ...(options.usb?.length && { usb: options.usb }),
            },
        ],
        ...(options.runsDirectory && { directory: options.runsDirectory }),
    })

    let results: Awaited<ReturnType<typeof runReadOnlyHardwareChecks>>
    try {
        results = await runReadOnlyHardwareChecks(target, () => false)
    } catch (error) {
        log.finish('failed')
        throw error
    }
    for (const capability of CAPABILITIES) {
        log.capabilityFinished(key, capability.id, results[capability.id], 0)
    }

    const row: SupportMatrixRow = {
        profile: profile.id,
        path: options.profilePath,
        manufacturer: profile.manufacturer,
        line: profile.line,
        model: profile.model,
        fidelity,
        ...(profile.catalog && { catalogLine: profile.catalog.line }),
        ...(options.usb?.length && { usb: options.usb }),
        ...(connection === 'ptp-ip' && { transport: 'ptp-ip' as const }),
        host,
        quirks: { total: 0, simulated: 0, unverified: 0 },
        results,
    }
    log.rowFinished(row)
    const matrixFile = path.join(
        options.resultsDirectory ?? path.join(packageDirectory, 'test-results/standalone-simulation'),
        hardwareMatrixName(profile.id, connection)
    )
    writeMatrix(matrixFile, [row])
    log.finish('completed', path.relative(packageDirectory, matrixFile))
    return { row, matrixFile, ...(log.file && { runFile: log.file }) }
}

/** Writes supplied rows without upgrading their fidelity; also used for historical hardware imports. */
export function writeMatrix(file: string, rows: SupportMatrixRow[]): SupportMatrix {
    const matrix: SupportMatrix = {
        generatedAt: new Date().toISOString(),
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows,
        lines: [],
        totals: Object.fromEntries(
            [...new Set(rows.map(row => row.fidelity))].map(fidelity => [
                fidelity,
                countStatuses(rows.filter(row => row.fidelity === fidelity)),
            ])
        ),
    }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(matrix, null, 2)}\n`)
    return matrix
}
