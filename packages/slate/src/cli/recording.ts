import type { Clip } from '@camera/driver/video'
import type { Camera } from '@camera/index'
import { describeDevice, selectBenchmarkCamera, type DiscoveredCamera } from '@cli/benchmark'

export interface StartRecordingOptions {
    camera?: { vendorId: number; productId: number }
    durationMilliseconds?: number
    json: boolean
}

/** The part of Camera this command drives: the generic recording operations only. */
export type RecordingCamera = Pick<Camera, 'connect' | 'disconnect' | 'startRecording' | 'stopRecording' | 'getRecordingState'>

export interface StartRecordingDependencies {
    discover(): Promise<DiscoveredCamera[]>
    createCamera(device: DiscoveredCamera): Promise<RecordingCamera>
    print(line: string): void
    progress(line: string): void
    /** Resolves when the user asks to stop (Ctrl-C or a termination signal); the returned function stops listening. */
    onStopRequest(request: () => void): () => void
}

const durationUnits: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
const longestDurationMilliseconds = 24 * 3_600_000

/** `10s`, `1.5s`, `2m`, `500ms`, `1h`; a bare number is seconds. */
export function parseRecordingDuration(text: string): number {
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(text.trim())
    const milliseconds = match ? Number(match[1]) * durationUnits[match[2] ?? 's']! : NaN
    if (!Number.isFinite(milliseconds) || milliseconds < 1000 || milliseconds > longestDurationMilliseconds)
        throw new Error(`"${text}" is not a recording duration from 1s to 24h, such as 10s or 2m`)
    return Math.round(milliseconds)
}

export function parseCameraId(text: string): { vendorId: number; productId: number } {
    if (!/^[a-f0-9]{4}:[a-f0-9]{4}$/i.test(text)) throw new Error(`"${text}" is not a USB id such as 054c:0e78`)
    const [vendorId, productId] = text.split(':').map(part => parseInt(part, 16))
    return { vendorId: vendorId!, productId: productId! }
}

async function defaultDependencies(): Promise<StartRecordingDependencies> {
    const { Camera } = await import('@camera/index')
    return {
        discover: () => Camera.discover(),
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
            }),
        print: line => console.log(line),
        progress: line => console.error(line),
        onStopRequest(request) {
            process.on('SIGINT', request)
            process.on('SIGTERM', request)
            return () => {
                process.removeListener('SIGINT', request)
                process.removeListener('SIGTERM', request)
            }
        },
    }
}

function describeClip(clip: Clip): string {
    const size = clip.sizeBytes === undefined ? '' : ` (${(clip.sizeBytes / 1_000_000).toFixed(1)} MB)`
    return `Stopped. ${clip.name}${size} is on the card.`
}

/**
 * `darkgrade camera start-recording [--duration 10s]`: stays in the foreground holding the session,
 * and stops on Ctrl-C or after the duration. Stop is always sent once the camera may be recording;
 * when it cannot be confirmed, the session is left open rather than closed under a running take.
 */
export async function runStartRecordingCommand(
    options: StartRecordingOptions,
    injected?: StartRecordingDependencies
): Promise<number> {
    const dependencies = injected ?? (await defaultDependencies())
    let device: DiscoveredCamera
    if (options.camera) device = options.camera
    else {
        const selection = selectBenchmarkCamera(await dependencies.discover())
        if (!('device' in selection)) {
            dependencies.progress(selection.message.replaceAll('darkgrade telemetry benchmark', 'darkgrade camera start-recording'))
            return 1
        }
        device = selection.device
    }
    const camera = await dependencies.createCamera(device)
    let requestStop: () => void = () => {}
    let stopAsked = false
    const stopRequested = new Promise<void>(resolve => (requestStop = resolve))
    const stopListening = dependencies.onStopRequest(() => {
        stopAsked = true
        requestStop()
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    let keepSession = false
    try {
        await camera.connect()
        if (stopAsked) {
            dependencies.progress('Cancelled before recording started.')
            return 1
        }
        dependencies.progress(`Starting to record on ${describeDevice(device)}…`)
        try {
            await camera.startRecording()
        } catch (error) {
            // A start the camera may still have acted on keeps Stop available: stop it now.
            if ((await camera.getRecordingState().catch(() => 'unknown' as const)) === 'idle') throw error
            dependencies.progress(`Record was not confirmed (${error instanceof Error ? error.message : String(error)}); stopping…`)
        }
        if (options.durationMilliseconds !== undefined) {
            dependencies.progress(`Recording for ${options.durationMilliseconds / 1000}s. Ctrl-C stops sooner.`)
            timer = setTimeout(() => requestStop(), options.durationMilliseconds)
        } else dependencies.progress('Recording. Press Ctrl-C to stop.')
        await stopRequested
        dependencies.progress('Stopping…')
        try {
            const clip = await camera.stopRecording()
            dependencies.print(options.json ? JSON.stringify({ stopped: true, clip }) : describeClip(clip))
            return 0
        } catch (error) {
            const state = await camera.getRecordingState().catch(() => 'unknown' as const)
            keepSession = state !== 'idle'
            const message = error instanceof Error ? error.message : String(error)
            dependencies.print(
                options.json
                    ? JSON.stringify({ stopped: state === 'idle', state, error: message })
                    : state === 'idle'
                      ? `Stopped, but: ${message}`
                      : `Stop was not confirmed (${message}). The camera reports ${state}; check it before unplugging.`
            )
            return 1
        }
    } finally {
        if (timer) clearTimeout(timer)
        stopListening()
        // Closing the session under a take that may still be running can end it in another mode.
        if (!keepSession) await camera.disconnect()
    }
}
