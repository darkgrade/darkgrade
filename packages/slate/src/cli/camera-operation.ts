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
}

export interface CameraOperationDependencies {
    discover(): Promise<DiscoveredCamera[]>
    createCamera(device: DiscoveredCamera): Promise<Camera>
    writeFile(path: string, data: Uint8Array): Promise<void>
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
    let device: DiscoveredCamera
    if (options.camera) device = options.camera
    else {
        const selection = selectBenchmarkCamera(await dependencies.discover())
        if (!('device' in selection)) {
            terminal.report(selection.message.replaceAll('darkgrade telemetry benchmark', options.operation.cliCommand ?? 'darkgrade camera'))
            return 1
        }
        device = selection.device
    }
    const camera = await dependencies.createCamera(device)
    let keepSession = false
    try {
        if (!withoutConnect.has(options.operation.name)) await camera.connect()
        if (!terminal.quiet && !options.json) terminal.report(`${options.operation.summary}: ${describeDevice(device)}`)
        const outcome = await runOperation(camera, options.operation.name, input).catch(async error => {
            // Closing the session under a take that may still be running can end it in another mode.
            if (options.operation.name === 'stopRecording')
                keepSession = (await camera.getRecordingState().catch(() => 'unknown' as const)) !== 'idle'
            throw error
        })
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
