import type { DiscoveredCamera } from '@camera/driver'
import type { Camera } from '@camera/index'
import { CameraOperationQueue } from '@core/operation-queue'
import {
    readOperationInput,
    runOperation,
    surfaceOperation,
    type OperationFile,
    type OperationInput,
} from '@runtime/operations'

/** An operation's result as it crosses a process: JSON, with any bytes the host saved by path. */
export interface OperationReply {
    result: unknown
    /** The files the operation returned, without their bytes; `path` where the host saved one. */
    files: { role: OperationFile['role']; name: string; mimeType: string; bytes: number; path?: string }[]
    /** Image files inline (live-view frames and previews), for clients that show pictures. */
    images?: { mimeType: string; base64: string }[]
}

/** What MCP and other remote frontends call: the public operations, by their library name. */
export interface CameraClient {
    /** `Camera.discover()`: the attached cameras, without opening one. */
    discover(): Promise<DiscoveredCamera[]>
    /** Runs one public Camera operation on the host's camera with this identity. */
    operation(camera: string, name: string, input?: OperationInput): Promise<OperationReply>
    /** The deep benchmark workflow, `runBenchmark`, where the host offers it. */
    benchmark?(camera: string): Promise<unknown>
}

/**
 * Platform hosts supply the connected Camera and physical services, never a second MCP-owned
 * session. The runtime runs every operation through Camera itself, so hosts keep no vendor tables.
 */
export interface CameraProvider {
    discover(): Promise<DiscoveredCamera[]>
    /** The Camera the host holds for this identity, already connected or ready for `connect`. */
    camera(camera: string): Camera | Promise<Camera>
    /** Throws (for example HardwareBusyError) when this operation may not run now. */
    assertAllowed(camera: string, operation: string): void | Promise<void>
    /** Keeps a returned file where the client can read it; the path is returned in the reply. */
    saveFile?(camera: string, file: OperationFile): Promise<string>
    benchmark?(camera: string): Promise<unknown>
}

const inlineImages = new Set<OperationFile['role']>(['frame', 'overlay', 'preview'])

function base64(data: Uint8Array): string {
    let binary = ''
    for (let index = 0; index < data.length; index += 0x8000)
        binary += String.fromCharCode(...data.subarray(index, index + 0x8000))
    return btoa(binary)
}

/**
 * One runtime per session-owning host. All frontends share its per-camera queue, so their
 * operations take turns; stopZoom and stopRecording never wait behind other work. Commands are
 * sent once: a failed or unconfirmed one is reported, never repeated by the runtime.
 * Physical cross-process leases remain in the provider's shared ownership store.
 */
export class CameraRuntime implements CameraClient {
    private readonly operations = new CameraOperationQueue()
    constructor(private readonly provider: CameraProvider) {}

    /** Owning hosts use the same queue for connection lifecycle and recording operations. */
    runExclusive<T>(camera: string, operation: () => Promise<T>): Promise<T> {
        return this.run(camera, operation)
    }

    discover(): Promise<DiscoveredCamera[]> {
        return this.provider.discover()
    }

    benchmark(camera: string): Promise<unknown> {
        return this.run(camera, async () => {
            if (!this.provider.benchmark) throw new Error('This host does not expose profile benchmarks')
            return this.provider.benchmark(camera)
        })
    }

    private run<T>(camera: string, operation: () => Promise<T>): Promise<T> {
        if (typeof camera !== 'string' || !camera.trim()) return Promise.reject(new Error('A valid camera identity is required'))
        return this.operations.run(camera, operation)
    }

    async operation(camera: string, name: string, input: OperationInput = {}): Promise<OperationReply> {
        const operation = surfaceOperation(name)
        if (!operation || operation.static)
            throw new Error(`Unknown camera operation ${name}`)
        // Inputs are read when the call is made, so a queued call keeps what it was given.
        const accepted = readOperationInput(operation, input)
        const execute = async () => {
            await this.provider.assertAllowed(camera, name)
            // Resolved after queuing: the host may have replaced its camera meanwhile.
            const target = await this.provider.camera(camera)
            const outcome = await runOperation(target, name, accepted)
            return this.reply(camera, outcome.result, outcome.files)
        }
        if (operation.immediate) {
            if (typeof camera !== 'string' || !camera.trim()) throw new Error('A valid camera identity is required')
            return execute()
        }
        return this.run(camera, execute)
    }

    private async reply(camera: string, result: unknown, files: OperationFile[]): Promise<OperationReply> {
        const described: OperationReply['files'] = []
        const images: NonNullable<OperationReply['images']> = []
        for (const file of files) {
            const path = this.provider.saveFile ? await this.provider.saveFile(camera, file) : undefined
            described.push({ role: file.role, name: file.name, mimeType: file.mimeType, bytes: file.data.byteLength, ...(path && { path }) })
            if (inlineImages.has(file.role)) images.push({ mimeType: file.mimeType, base64: base64(file.data) })
        }
        return { result, files: described, ...(images.length && { images }) }
    }
}
