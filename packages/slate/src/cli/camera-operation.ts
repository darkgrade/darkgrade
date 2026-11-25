import type { Camera } from '@camera/index'
import { describeDevice, selectBenchmarkCamera, type DiscoveredCamera } from '@cli/benchmark'
import type { Terminal } from '@cli/terminal'
import { readOperationInput, runOperation, type OperationFile, type SurfaceOperation } from '@runtime/operations'

export interface CameraOperationOptions {
    operation: SurfaceOperation
    /** The inputs by parameter name, as text from the command line. */
    input: Record<string, string | boolean>
    camera?: { vendorId: number; productId: number }
    /** Where to write a returned file; a second file goes beside it. */
    outputPath?: string
    json: boolean
    /** Holds a start operation in the foreground until Ctrl-C or the duration, then runs `stop`. */
    hold?: { stop: SurfaceOperation; durationMilliseconds?: number }
}

export interface CameraOperationDependencies {
    discover(): Promise<DiscoveredCamera[]>
    createCamera(device: DiscoveredCamera): Promise<Camera>
    writeFile(path: string, data: Uint8Array): Promise<void>
    /** Calls `request` on Ctrl-C or a termination signal; the returned function stops listening. */
    onStopRequest(request: () => void): () => void
}

/** Operations that run on a camera that may not answer, so they are not preceded by connect. */
const withoutConnect = new Set(['recover'])

async function defaultDependencies(): Promise<CameraOperationDependencies> {
    const { Camera } = await import('@camera/index')
    const { writeFile } = await import('node:fs/promises')
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
        writeFile: (path, data) => writeFile(path, data),
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

/** Resolves on Ctrl-C, a termination signal or after the duration. */
async function untilStopRequested(dependencies: CameraOperationDependencies, durationMilliseconds?: number): Promise<void> {
    let stopListening = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    await new Promise<void>(resolve => {
        stopListening = dependencies.onStopRequest(resolve)
        if (durationMilliseconds !== undefined) timer = setTimeout(resolve, durationMilliseconds)
    })
    stopListening()
    if (timer) clearTimeout(timer)
}

async function selectDevice(
    camera: CameraOperationOptions['camera'],
    command: string,
    terminal: Terminal,
    dependencies: CameraOperationDependencies
): Promise<DiscoveredCamera | undefined> {
    if (camera) return camera
    const selection = selectBenchmarkCamera(await dependencies.discover())
    if ('device' in selection) return selection.device
    terminal.report(selection.message.replaceAll('darkgrade telemetry benchmark', command))
    return undefined
}

/**
 * `darkgrade camera watch`: opens the camera and prints one line per camera event, the library's
 * `settingsChanged` and `mediaAdded`, until Ctrl-C or the duration. Reads only.
 */
export async function runWatchCommand(
    options: Pick<CameraOperationOptions, 'camera' | 'json'> & { durationMilliseconds?: number },
    terminal: Terminal,
    injected?: CameraOperationDependencies
): Promise<number> {
    const dependencies = injected ?? (await defaultDependencies())
    const device = await selectDevice(options.camera, 'darkgrade camera watch', terminal, dependencies)
    if (!device) return 1
    const camera = await dependencies.createCamera(device)
    try {
        await camera.connect({ observeOnly: true })
        if (!terminal.quiet && !options.json) terminal.report(`Watching ${describeDevice(device)}. Press Ctrl-C to stop.`)
        for (const event of ['settingsChanged', 'mediaAdded'] as const)
            camera.on(event, () => terminal.print(options.json ? JSON.stringify({ event, at: new Date().toISOString() }) : event))
        await untilStopRequested(dependencies, options.durationMilliseconds)
        return 0
    } finally {
        await camera.disconnect().catch(() => undefined)
    }
}

/** `photo.jpg` for the first file, `photo-overlay.png` beside it for a second. */
function filePath(file: OperationFile, index: number, outputPath: string | undefined): string {
    if (!outputPath) return file.name.replace(/[/\\]/g, '_')
    if (index === 0) return outputPath
    const extension = file.name.split('.').pop()
    return `${outputPath.replace(/\.[^./\\]+$/, '')}-${file.role}.${extension}`
}

/**
 * `darkgrade camera <operation>`: opens the attached camera, runs the one public operation through
 * the same call the library and the MCP tools make, writes any file it returns, prints the result
 * and closes the camera. The command is sent once; an unconfirmed result is reported, not resent.
 */
export async function runCameraOperationCommand(
    options: CameraOperationOptions,
    terminal: Terminal,
    injected?: CameraOperationDependencies
): Promise<number> {
    const input = readOperationInput(options.operation, options.input)
    const dependencies = injected ?? (await defaultDependencies())
    const device = await selectDevice(options.camera, options.operation.cliCommand, terminal, dependencies)
    if (!device) return 1
    const camera = await dependencies.createCamera(device)
    let keepSession = false
    try {
        if (!withoutConnect.has(options.operation.name)) await camera.connect()
        if (!terminal.quiet && !options.json) terminal.report(`${options.operation.summary}: ${describeDevice(device)}`)
        // Closing the session under a take that may still be running can end it in another mode.
        const keepIfRecording = async (error: unknown): Promise<never> => {
            if (options.operation.name === 'stopRecording' || options.hold?.stop.name === 'stopRecording')
                keepSession = (await camera.getRecordingState().catch(() => 'unknown' as const)) !== 'idle'
            throw error
        }
        let outcome = await runOperation(camera, options.operation.name, input).catch(keepIfRecording)
        if (options.hold) {
            if (!terminal.quiet && !options.json) terminal.report('Press Ctrl-C to stop.')
            await untilStopRequested(dependencies, options.hold.durationMilliseconds)
            // Stop is sent once and never waits behind anything else.
            outcome = await runOperation(camera, options.hold.stop.name, {}).catch(keepIfRecording)
        }
        const written: { role: OperationFile['role']; path: string; bytes: number }[] = []
        for (const [index, file] of outcome.files.entries()) {
            const path = filePath(file, index, options.outputPath)
            await dependencies.writeFile(path, file.data)
            written.push({ role: file.role, path, bytes: file.data.byteLength })
        }
        const result = written.length ? { result: outcome.result, files: written } : outcome.result
        terminal.print(options.json || !terminal.readable ? JSON.stringify(result) : JSON.stringify(result, null, 2))
        return 0
    } finally {
        if (!withoutConnect.has(options.operation.name) && !keepSession) await camera.disconnect().catch(() => undefined)
    }
}
