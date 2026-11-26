import type { Clip } from '@camera/driver'
import type { Camera } from '@camera/index'
import type { DiscoveredCamera } from '@camera/driver'
import { cameraCommandDependencies, chooseCameraDevice, describeDevice } from '@cli/camera-selection'
export { parseCameraId } from '@cli/camera-selection'

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

async function defaultDependencies(): Promise<StartRecordingDependencies> {
    return { ...(await cameraCommandDependencies()), print: line => console.log(line), progress: line => console.error(line) }
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
export async function runStartRecordingCommand(options: StartRecordingOptions, injected?: StartRecordingDependencies): Promise<number> {
    const dependencies = injected ?? (await defaultDependencies())
    const command = 'darkgrade camera start-recording'
    const device = await chooseCameraDevice(options.camera, () => dependencies.discover(), command, text => dependencies.progress(text))
    if (!device) return 1
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
    let unconfirmedStart: string | undefined
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
            unconfirmedStart = error instanceof Error ? error.message : String(error)
            dependencies.progress(`Record was not confirmed (${unconfirmedStart}); stopping…`)
            requestStop()
        }
        if (unconfirmedStart === undefined && options.durationMilliseconds !== undefined) {
            dependencies.progress(`Recording for ${options.durationMilliseconds / 1000}s. Ctrl-C stops sooner.`)
            timer = setTimeout(() => requestStop(), options.durationMilliseconds)
        } else if (unconfirmedStart === undefined) dependencies.progress('Recording. Press Ctrl-C to stop.')
        await stopRequested
        dependencies.progress('Stopping…')
        try {
            const clip = await camera.stopRecording()
            if (unconfirmedStart === undefined) {
                dependencies.print(options.json ? JSON.stringify({ stopped: true, clip }) : describeClip(clip))
                return 0
            }
            const unconfirmed = { stopped: true, clip, startConfirmed: false, error: unconfirmedStart }
            dependencies.print(options.json ? JSON.stringify(unconfirmed) : `${describeClip(clip)} Record was not confirmed: ${unconfirmedStart}`)
            return 1
        } catch (error) {
            const state = await camera.getRecordingState().catch(() => 'unknown' as const)
            keepSession = state !== 'idle'
            const message = error instanceof Error ? error.message : String(error)
            const startNote = unconfirmedStart === undefined ? {} : { startConfirmed: false, startError: unconfirmedStart }
            const text = state === 'idle' ? `Stopped, but: ${message}`
                : `Stop was not confirmed (${message}). The camera reports ${state}; check it before unplugging.`
            dependencies.print(options.json ? JSON.stringify({ stopped: state === 'idle', state, error: message, ...startNote }) : text)
            return 1
        }
    } finally {
        if (timer) clearTimeout(timer)
        stopListening()
        // Closing the session under a take that may still be running can end it in another mode.
        if (!keepSession) await camera.disconnect()
    }
}
