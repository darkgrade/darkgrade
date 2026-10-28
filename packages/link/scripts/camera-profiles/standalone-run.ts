/**
 * Runs the compatibility capabilities against one physical camera outside CI, streaming progress to a
 * run log the compatibility UI tails, and writes a one-row hardware matrix that `lab:results` and
 * `compat:merge` pick up. The camera's profile supplies the values darkgrade must decode; captured
 * traffic is never replayed on hardware, and a changed property is restored before it passes.
 */
import { Camera } from '@camera/index'
import { ResponseRecordingTransport } from '@scripts/camera-lab/response-recording-transport'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import type { CameraProfile } from '@transport/simulated/camera-profile'
import { mkdirSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { CAPABILITIES, evaluateCapabilities, type CameraConnection, type SimulatedCamera } from './camera-capabilities'
import { packageDirectory, ProgressLog, rowKey } from './compat-progress'
import { countStatuses, type SupportMatrix, type SupportMatrixRow } from './support-matrix'

const HARDWARE_TIMEOUT_MILLISECONDS = 30_000
const DISCONNECT_TIMEOUT_MILLISECONDS = 5_000

export const hardwareResultsDirectory = path.join(packageDirectory, 'test-results/camera-lab')

export interface StandaloneRunOptions {
    profile: CameraProfile
    profilePath: string
    /** The real transport (USBTransport or IPTransport). */
    transport: TransportInterface
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
    const transport = new ResponseRecordingTransport(options.transport)
    const target: SimulatedCamera = {
        profile,
        camera: new Camera({
            transport,
            vendorId: options.vendorId,
            logger: { renderInTerminal: false, captureConsole: false, expanded: false },
        }),
        transport,
        tier: 'hardware',
        connection,
        ...(options.device && { device: options.device }),
        timeoutMilliseconds: options.timeoutMilliseconds ?? HARDWARE_TIMEOUT_MILLISECONDS,
    }
    const key = rowKey({ fidelity: 'hardware', transport: connection, profile: profile.id })
    const host = options.host ?? hostname()
    const log = ProgressLog.start({
        source: 'hardware',
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
                fidelity: 'hardware',
                transport: connection,
                ...(options.usb?.length && { usb: options.usb }),
            },
        ],
        ...(options.runsDirectory && { directory: options.runsDirectory }),
    })

    const results = await evaluateCapabilities(target, {
        onStart: capability => log.capabilityStarted(key, capability),
        onResult: (capability, result, duration) => log.capabilityFinished(key, capability, result, duration),
    })
    const firmware = results.session?.status === 'pass' ? await readFirmware(target).catch(() => undefined) : undefined
    await Promise.race([
        target.camera.disconnect().catch(() => undefined),
        new Promise(resolve => setTimeout(resolve, DISCONNECT_TIMEOUT_MILLISECONDS)),
    ])

    const row: SupportMatrixRow = {
        profile: profile.id,
        path: options.profilePath,
        manufacturer: profile.manufacturer,
        line: profile.line,
        model: profile.model,
        fidelity: 'hardware',
        ...((firmware || profile.firmware) && { firmware: firmware || profile.firmware! }),
        ...(profile.catalog && { catalogLine: profile.catalog.line }),
        ...(options.usb?.length && { usb: options.usb }),
        ...(connection === 'ptp-ip' && { transport: 'ptp-ip' as const }),
        host,
        quirks: { total: 0, simulated: 0, unverified: 0 },
        results,
    }
    log.rowFinished(row)
    const matrixFile = path.join(
        options.resultsDirectory ?? hardwareResultsDirectory,
        hardwareMatrixName(profile.id, connection)
    )
    writeMatrix(matrixFile, [row])
    log.finish('completed', path.relative(packageDirectory, matrixFile))
    return { row, matrixFile, ...(log.file && { runFile: log.file }) }
}

/** Writes hardware rows as a support matrix in the format `lab:results` combines. */
export function writeMatrix(file: string, rows: SupportMatrixRow[]): SupportMatrix {
    const matrix: SupportMatrix = {
        generatedAt: new Date().toISOString(),
        capabilities: CAPABILITIES.map(({ id, label }) => ({ id, label })),
        rows,
        lines: [],
        totals: { hardware: countStatuses(rows) },
    }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, `${JSON.stringify(matrix, null, 2)}\n`)
    return matrix
}

/** The firmware the camera reports in DeviceInfo. */
async function readFirmware(target: SimulatedCamera): Promise<string | undefined> {
    const instance = target.camera.getInstance()
    const response = await instance.send(instance.registry.operations.GetDeviceInfo, {})
    return response.data?.deviceVersion || undefined
}
