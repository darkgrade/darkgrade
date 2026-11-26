import type { DiscoveredCamera } from '@camera/driver'
import type { Camera, CameraOptions } from '@camera/index'
import type { Terminal } from '@cli/terminal'
import { getVendorName } from '@ptp/definitions/vendor-ids'
import { vendorEntry, vendorTable } from '@vendors/vendors'
import type { BenchmarkCheck, runBenchmark } from '@workflows/telemetry-benchmark'
import { formatUsbDeviceId, parseUsbDeviceId } from '@transport/usb/usb-device-id'
export type { DiscoveredCamera }

export const benchmarkUsage = 'benchmark [--camera VID:PID] [--no-capture] [--no-live] [--json]'

export interface BenchmarkArguments {
    camera?: { vendorId: number; productId: number }
    capture: boolean
    live: boolean
    json: boolean
}

/** No flags runs everything. `--capture`/`--live` are accepted for older scripts and change nothing. */
export function parseBenchmarkArguments(args: readonly string[]): BenchmarkArguments {
    const flags = ['--capture', '--live', '--no-capture', '--no-live', '--json']
    const parsed: Pick<BenchmarkArguments, 'camera'> = {}
    for (let index = 0; index < args.length; index++) {
        const value = args[index]
        const usage = new Error(`Usage: darkgrade telemetry ${benchmarkUsage}`)
        if (value === '--camera') {
            if (parsed.camera) throw usage
            try {
                parsed.camera = parseCameraId(args[++index] ?? '')
            } catch {
                throw usage
            }
        } else if (!flags.includes(value)) throw usage
    }
    return { ...parsed, capture: !args.includes('--no-capture'), live: !args.includes('--no-live'), json: args.includes('--json') }
}

export function parseCameraId(text: string): { vendorId: number; productId: number } {
    const id = parseUsbDeviceId(text)
    if (!id) throw new Error(`"${text}" is not a USB id such as 054c:0e78`)
    return id
}

/** A Camera for one discovered USB device, logging nothing to the terminal. */
export async function cameraForDevice(device: DiscoveredCamera, options: CameraOptions = {}): Promise<Camera> {
    const { Camera } = await import('@camera/index')
    const { vendorId, productId, serialNumber } = device
    return new Camera({
        device: { usb: { filters: [{ vendorId, productId, ...(serialNumber && { serialNumber }) }] } },
        ...options,
    })
}

/** Calls `request` on Ctrl-C or a termination signal; the returned function stops listening. */
export function onProcessStopRequest(request: () => void): () => void {
    process.on('SIGINT', request)
    process.on('SIGTERM', request)
    return () => void process.removeListener('SIGINT', request).removeListener('SIGTERM', request)
}

export const usbId = (device: { vendorId: number; productId: number }) => formatUsbDeviceId(device)

export const describeDevice = (device: DiscoveredCamera) =>
    `${device.model ?? getVendorName(device.vendorId)} (${usbId(device)})`

export const connectionHelp = [
    'Connect the camera with a USB data cable, switch it on and set its USB mode for computer control:',
    '  Sony: USB Connection Mode "PC Remote" (or "Remote Shooting"), not Mass Storage.',
    '  Fujifilm: Connection Setting "USB Tether Shooting Auto" (or PC Shoot), not Card Reader / USB RAW Conv.',
    '  Canon and Nikon: no setting is usually needed; close the vendor utility (EOS Utility, NX Tether).',
    'Then run the command again.',
].join('\n')

/** One device is used; several are narrowed to the sole camera-maker device, otherwise the user picks. */
export function selectBenchmarkCamera(
    devices: readonly DiscoveredCamera[],
    otherModes: readonly DiscoveredCamera[] = [],
    command = 'darkgrade telemetry benchmark'
): { device: DiscoveredCamera } | { message: string } {
    if (devices.length === 1) return { device: devices[0] }
    if (!devices.length) {
        const elsewhere = otherModes.map(device => `  ${describeDevice(device)} is attached but not in PTP mode.`)
        return { message: ['No camera found.', ...elsewhere, connectionHelp].join('\n') }
    }
    const cameras = devices.filter(device => vendorEntry(device.vendorId))
    if (cameras.length === 1) return { device: cameras[0] }
    return {
        message: [
            'Several cameras are attached. Choose one with --camera VID:PID:',
            ...devices.map(device => `  ${command} --camera ${usbId(device)}   # ${describeDevice(device)}`),
        ].join('\n'),
    }
}

/** The requested device, else the one `selectBenchmarkCamera` picks; otherwise its message is reported. */
export async function chooseCameraDevice(
    requested: DiscoveredCamera | undefined,
    discover: () => Promise<DiscoveredCamera[]>,
    command: string,
    report: (message: string) => void
): Promise<DiscoveredCamera | undefined> {
    if (requested) return requested
    const selection = selectBenchmarkCamera(await discover(), [], command)
    if ('device' in selection) return selection.device
    report(selection.message)
    return undefined
}

/** What the one-camera commands open the attached camera with. */
export async function cameraCommandDependencies() {
    const { Camera } = await import('@camera/index')
    return {
        discover: () => Camera.discover(),
        createCamera: (device: DiscoveredCamera) => cameraForDevice(device),
        onStopRequest: onProcessStopRequest,
    }
}

/** Known camera makers attached in another USB class (card reader, MTP). Discovery failures count as none. */
export async function camerasInOtherModes(): Promise<DiscoveredCamera[]> {
    try {
        const { Logger } = await import('@core/logger')
        const { USBTransport } = await import('@transport/usb/usb-transport')
        const transport = new USBTransport(new Logger())
        const devices = await transport.discover({ usb: { filters: vendorTable.map(({ vendorId }) => ({ vendorId })) } })
        return devices.filter(device => device.classCode !== 0x06)
    } catch {
        return []
    }
}

type BenchmarkResult = Awaited<ReturnType<typeof runBenchmark>>
/** The diagnostics client's flush outcome: 'sent', 'empty', 'retry', 'rejected', 'disabled' or 'timeout'. */
type UploadResult = string

export function benchmarkSummary(
    device: DiscoveredCamera,
    result: BenchmarkResult,
    profilePath: string,
    uploads: readonly UploadResult[]
): string {
    const properties = result.checks.filter(check => check.name.startsWith('property-'))
    const outcome = (name: string, skipped: boolean) => {
        if (skipped) return 'skipped'
        const check = result.checks.find(item => item.name === name)
        return !check ? 'not run' : check.passed ? 'ok' : `failed (${check.error})`
    }
    const failed = result.checks.filter(check => !check.passed && !check.name.startsWith('property-'))
    const queued = uploads.includes('retry') || uploads.includes('timeout')
    const uploaded = uploads.includes('sent') ? 'uploaded'
        : uploads.includes('disabled') ? 'not uploaded (sharing is off)'
        : queued ? 'queued; will retry' : 'not uploaded'
    const identity = result.profile.identity
    return [
        `${result.passed ? 'Benchmark complete' : `Benchmark ${result.profile.status}`}: ${
            identity ? `${identity.manufacturer} ${identity.model}, firmware ${identity.firmware}` : describeDevice(device)
        }`,
        `  Properties read: ${properties.filter(check => check.passed).length}/${properties.length}`,
        `  Photo capture:   ${outcome('photo-transfer', !result.checks.some(item => item.name === 'photo-transfer'))}`,
        `  Live view:       ${outcome('live-transfer', !result.checks.some(item => item.name === 'live-transfer'))}`,
        ...(failed.length ? [`  Failed checks:   ${failed.map(check => check.name).join(', ')}`] : []),
        `  Profile saved:   ${profilePath}`,
        `  Telemetry:       ${uploaded}`,
    ].join('\n')
}

export interface BenchmarkCommandDependencies {
    discover(): Promise<DiscoveredCamera[]>
    camerasInOtherModes(): Promise<DiscoveredCamera[]>
    createCamera(device: DiscoveredCamera): Promise<Camera>
    runBenchmark: typeof runBenchmark
    saveProfile(profile: BenchmarkResult['profile']): string
    flush(): Promise<UploadResult>
    print(line: string): void
    progress(line: string): void
    /** A transient status line, present only where the terminal can redraw one. */
    status?(text: string): void
    clearStatus?(): void
    /** Asks which of several cameras to use; absent where no question may be asked. */
    choose?(devices: readonly DiscoveredCamera[]): Promise<DiscoveredCamera | undefined>
}

/** `--camera` wins; DARKGRADE_CAMERA names the device for scripts and shells that always use one body. */
function cameraFromEnvironment(value: string | undefined): BenchmarkArguments['camera'] {
    if (!value) return undefined
    try {
        return parseCameraId(value)
    } catch {
        throw new Error('DARKGRADE_CAMERA must be a USB id such as 054c:0e78')
    }
}

async function defaultDependencies(terminal?: Terminal): Promise<BenchmarkCommandDependencies> {
    const progress = terminal?.progress()
    const { Camera } = await import('@camera/index')
    const { runBenchmark } = await import('@workflows/telemetry-benchmark')
    const { nodeDiagnostics, saveDiagnosticProfile } = await import('@contribute/settings')
    return {
        discover: () => Camera.discover(),
        camerasInOtherModes,
        createCamera: device =>
            cameraForDevice(device, {
                transactionPolicy: { timeoutMilliseconds: 10_000, deviceBusyRetries: 1 },
                // This command runs the full inventory itself.
                firstContact: false,
            }),
        runBenchmark,
        saveProfile: saveDiagnosticProfile,
        flush: async () => (await nodeDiagnostics()).flush(),
        print: line => (terminal ? terminal.print(line) : console.log(line)),
        progress: line => (progress ? progress.note(line) : console.error(line)),
        ...(terminal?.animated && progress && { status: text => progress.update(text), clearStatus: () => progress.stop() }),
        ...(terminal?.interactive && {
            choose: devices =>
                terminal.select(
                    'Several cameras are attached. Which one?',
                    devices.map(device => ({ label: device.model ?? getVendorName(device.vendorId), hint: usbId(device), value: device }))
                ),
        }),
    }
}

/** `darkgrade telemetry benchmark`: find the attached camera and run every check on it. */
export async function runBenchmarkCommand(
    args: readonly string[],
    injected?: BenchmarkCommandDependencies,
    terminal?: Terminal
): Promise<number> {
    const options = parseBenchmarkArguments(args)
    const requested = options.camera ?? cameraFromEnvironment(process.env.DARKGRADE_CAMERA)
    const dependencies = injected ?? (await defaultDependencies(terminal))
    let device: DiscoveredCamera
    if (requested) device = requested
    else {
        dependencies.status?.('Looking for a camera…')
        const devices = await dependencies.discover()
        const selection = selectBenchmarkCamera(devices, devices.length ? [] : await dependencies.camerasInOtherModes())
        dependencies.clearStatus?.()
        if ('device' in selection) device = selection.device
        else if (devices.length > 1 && dependencies.choose) {
            const chosen = await dependencies.choose(devices)
            if (!chosen) {
                dependencies.progress('Cancelled. No camera was opened.')
                return 1
            }
            device = chosen
        } else {
            dependencies.progress(selection.message)
            return 1
        }
        if (!dependencies.status) dependencies.progress(`Benchmarking ${describeDevice(device)}…`)
    }
    dependencies.status?.(`Connecting to ${describeDevice(device)}…`)
    const started = Date.now()
    let completed = 0
    const reportCheck = (check: BenchmarkCheck) => {
        completed++
        if (!dependencies.status) return dependencies.progress(`${check.passed ? '✓' : '!'} ${check.name}`)
        // Unreadable properties are counted in the summary; other failures are worth a line of their own.
        if (!check.passed && !check.name.startsWith('property-')) dependencies.progress(`! ${check.name}`)
        const seconds = Math.round((Date.now() - started) / 1000)
        dependencies.status(`Benchmarking ${describeDevice(device)} · ${completed} checks · ${seconds}s · ${check.name}`)
    }
    const camera = await dependencies.createCamera(device)
    const cancellation = new AbortController()
    const cancel = () => cancellation.abort()
    const stopListening = onProcessStopRequest(cancel)
    const deadline = setTimeout(cancel, 200_000)
    const uploads: UploadResult[] = []
    const flush = async () => {
        const upload = await dependencies.flush()
        uploads.push(upload)
        return upload
    }
    try {
        await camera.connect()
        const result = await dependencies.runBenchmark(camera, {
            photo: options.capture,
            liveView: options.live,
            maximumProperties: 512,
            signal: cancellation.signal,
            flushEvidence: flush,
            onProgress: reportCheck,
        })
        const profilePath = dependencies.saveProfile(result.profile)
        dependencies.status?.('Saving the profile…')
        const upload = await flush()
        dependencies.clearStatus?.()
        dependencies.print(
            options.json ? JSON.stringify({ ...result, profilePath, upload }) : benchmarkSummary(device, result, profilePath, uploads)
        )
        return result.passed ? 0 : 1
    } finally {
        dependencies.clearStatus?.()
        try {
            await camera.disconnect()
        } finally {
            clearTimeout(deadline)
            stopListening()
        }
    }
}
