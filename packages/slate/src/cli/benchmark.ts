import type { Camera } from '@camera/index'
import { getVendorName, isSupportedVendor, VendorIDs } from '@ptp/definitions/vendor-ids'
import type { BenchmarkCheck, runCameraBenchmark } from '@workflows/telemetry-benchmark'

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
    const parsed: BenchmarkArguments = { capture: true, live: true, json: false }
    for (let index = 0; index < args.length; index++) {
        const value = args[index]
        if (value === '--camera') {
            const camera = args[++index]
            if (!/^[a-f0-9]{4}:[a-f0-9]{4}$/i.test(camera ?? '') || parsed.camera) throw new Error(benchmarkUsage)
            const [vendorId, productId] = camera.split(':').map(part => parseInt(part, 16))
            parsed.camera = { vendorId, productId }
        } else if (!flags.includes(value)) throw new Error(benchmarkUsage)
    }
    if (args.includes('--no-capture')) parsed.capture = false
    if (args.includes('--no-live')) parsed.live = false
    parsed.json = args.includes('--json')
    return parsed
}

export interface DiscoveredCamera {
    vendorId: number
    productId: number
    serialNumber?: string
    model?: string
}

const usbId = (device: { vendorId: number; productId: number }) =>
    [device.vendorId, device.productId].map(value => value.toString(16).padStart(4, '0')).join(':')

export const describeDevice = (device: DiscoveredCamera) =>
    `${device.model ?? getVendorName(device.vendorId)} (${usbId(device)})`

const connectionHelp = [
    'Connect the camera with a USB data cable, switch it on and set its USB mode for computer control:',
    '  Sony: USB Connection Mode "PC Remote" (or "Remote Shooting"), not Mass Storage.',
    '  Fujifilm: Connection Setting "USB Tether Shooting Auto" (or PC Shoot), not Card Reader / USB RAW Conv.',
    '  Canon and Nikon: no setting is usually needed; close the vendor utility (EOS Utility, NX Tether).',
    'Then run the command again.',
].join('\n')

/** One device is used; several are narrowed to the sole camera-maker device, otherwise the user picks. */
export function selectBenchmarkCamera(
    devices: readonly DiscoveredCamera[],
    otherModes: readonly DiscoveredCamera[] = []
): { device: DiscoveredCamera } | { message: string } {
    if (devices.length === 1) return { device: devices[0] }
    if (!devices.length) {
        const elsewhere = otherModes.map(device => `  ${describeDevice(device)} is attached but not in PTP mode.`)
        return { message: ['No camera found.', ...elsewhere, connectionHelp].join('\n') }
    }
    const cameras = devices.filter(device => isSupportedVendor(device.vendorId))
    if (cameras.length === 1) return { device: cameras[0] }
    return {
        message: [
            'Several cameras are attached. Choose one with --camera VID:PID:',
            ...devices.map(device => `  darkgrade telemetry benchmark --camera ${usbId(device)}   # ${describeDevice(device)}`),
        ].join('\n'),
    }
}

/** Known camera makers attached in another USB class (card reader, MTP). Discovery failures count as none. */
async function camerasInOtherModes(): Promise<DiscoveredCamera[]> {
    try {
        const { Logger } = await import('@core/logger')
        const { USBTransport } = await import('@transport/usb/usb-transport')
        const transport = new USBTransport(new Logger({ renderInTerminal: false, captureConsole: false }))
        const devices = await transport.discover({
            usb: { filters: Object.values(VendorIDs).map(vendorId => ({ vendorId })) },
        })
        return devices.filter(device => device.classCode !== 0x06)
    } catch {
        return []
    }
}

type BenchmarkResult = Awaited<ReturnType<typeof runCameraBenchmark>>
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
    const uploaded = uploads.includes('sent')
        ? 'uploaded'
        : uploads.includes('disabled')
          ? 'not uploaded (sharing is off)'
          : uploads.includes('retry') || uploads.includes('timeout')
            ? 'queued; will retry'
            : 'not uploaded'
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
    runBenchmark: typeof runCameraBenchmark
    saveProfile(profile: BenchmarkResult['profile']): string
    flush(): Promise<UploadResult>
    print(line: string): void
    progress(line: string): void
}

async function defaultDependencies(): Promise<BenchmarkCommandDependencies> {
    // Importing the CLI's preference commands never loads USB or opens a camera.
    const { Camera } = await import('@camera/index')
    const { runCameraBenchmark } = await import('@workflows/telemetry-benchmark')
    const { nodeDiagnostics, saveDiagnosticProfile } = await import('@contribute/settings')
    return {
        discover: () => Camera.discover(),
        camerasInOtherModes,
        createCamera: async device =>
            new Camera({
                device: {
                    usb: {
                        filters: [
                            {
                                vendorId: device.vendorId,
                                productId: device.productId,
                                ...(device.serialNumber && { serialNumber: device.serialNumber }),
                            },
                        ],
                    },
                },
                logger: { renderInTerminal: false, captureConsole: false },
                transactionPolicy: { timeoutMilliseconds: 10_000, deviceBusyRetries: 1 },
                // This command runs the full inventory itself.
                firstContact: false,
            }),
        runBenchmark: runCameraBenchmark,
        saveProfile: saveDiagnosticProfile,
        flush: async () => (await nodeDiagnostics()).flush(),
        print: line => console.log(line),
        progress: line => console.error(line),
    }
}

/** `darkgrade telemetry benchmark`: find the attached camera and run every check on it. */
export async function runBenchmarkCommand(
    args: readonly string[],
    injected?: BenchmarkCommandDependencies
): Promise<number> {
    const options = parseBenchmarkArguments(args)
    const dependencies = injected ?? (await defaultDependencies())
    let device: DiscoveredCamera
    if (options.camera) device = options.camera
    else {
        const devices = await dependencies.discover()
        const selection = selectBenchmarkCamera(
            devices,
            devices.length ? [] : await dependencies.camerasInOtherModes()
        )
        if ('message' in selection) {
            dependencies.progress(selection.message)
            return 1
        }
        device = selection.device
        dependencies.progress(`Benchmarking ${describeDevice(device)}…`)
    }
    const camera = await dependencies.createCamera(device)
    const cancellation = new AbortController()
    const cancel = () => cancellation.abort()
    process.once('SIGINT', cancel)
    process.once('SIGTERM', cancel)
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
            capture: options.capture,
            live: options.live,
            maximumProperties: 512,
            signal: cancellation.signal,
            flushEvidence: flush,
            onProgress: (check: BenchmarkCheck) => dependencies.progress(`${check.passed ? '✓' : '!'} ${check.name}`),
        })
        const profilePath = dependencies.saveProfile(result.profile)
        const upload = await flush()
        dependencies.print(
            options.json
                ? JSON.stringify({ ...result, profilePath, upload })
                : benchmarkSummary(device, result, profilePath, uploads)
        )
        return result.passed ? 0 : 1
    } finally {
        try {
            await camera.disconnect()
        } finally {
            clearTimeout(deadline)
            process.removeListener('SIGINT', cancel)
            process.removeListener('SIGTERM', cancel)
        }
    }
}
