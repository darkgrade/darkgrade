import type { DiscoveredCamera } from '@camera/driver'
import { HardwareBusyError } from '@runtime/errors'
import { readOperationInput, surfaceOperation, type OperationInput } from '@runtime/operations'
import type { CameraClient, OperationReply } from '@runtime/runtime'

/** Connect to the existing owning host. Does not create a local hardware session. */
export class HttpCameraClient implements CameraClient {
    private readonly base: URL
    constructor(
        base: string,
        private readonly request: (input: URL, init: RequestInit) => Promise<Response> = fetch
    ) {
        this.base = new URL(base)
        if (!['http:', 'https:'].includes(this.base.protocol) || this.base.username || this.base.password)
            throw new Error('Use an HTTP(S) runtime URL without embedded credentials')
    }
    private async call(path: string, body: unknown): Promise<unknown> {
        const url = new URL(path, this.base)
        let response: Response
        try {
            response = await this.request(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Bench-Action': '1' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(240000),
                redirect: 'error',
            })
        } catch (error) {
            const message = error instanceof Error && error.name === 'TimeoutError'
                ? 'Runtime request timed out'
                : 'Runtime connection failed'
            throw new Error(
                `${message}; the camera operation may still be running or have completed. Inspect the host before retrying.`,
                { cause: error }
            )
        }
        let result: unknown
        try {
            result = await response.json()
        } catch {
            const message = response.ok
                ? 'Camera runtime returned invalid JSON'
                : `Camera request failed (${response.status})`
            throw new Error(`${message}; the camera operation may still be running. Inspect the host before retrying.`)
        }
        const failure = result && typeof result === 'object' ? result as { error?: unknown; code?: unknown } : {}
        const message = typeof failure.error === 'string' ? failure.error : undefined
        if (response.status === 409 && failure.code === 'HARDWARE_BUSY')
            throw new HardwareBusyError(message || 'Camera is busy')
        if (!response.ok) throw new Error(message || `Camera request failed (${response.status})`)
        return result
    }
    private cameraPath(camera: string, endpoint: string): string {
        if (typeof camera !== 'string' || !camera.trim() || camera === '.' || camera === '..')
            throw new Error('A valid camera identity is required')
        return `/api/cameras/${encodeURIComponent(camera)}/${endpoint}`
    }
    async discover(): Promise<DiscoveredCamera[]> {
        const reply = await this.call('/api/cameras/discover', {})
        if (!Array.isArray(reply)) throw new Error('Camera runtime returned no camera list')
        return reply
    }
    /** Inputs are checked here too, so a malformed call never reaches the host. */
    async operation(camera: string, name: string, input: OperationInput = {}): Promise<OperationReply> {
        const operation = surfaceOperation(name)
        if (!operation || operation.name === 'discover') throw new Error(`Unknown camera operation ${name}`)
        readOperationInput(operation, input)
        const reply = await this.call(this.cameraPath(camera, `operations/${encodeURIComponent(name)}`), input)
        if (!reply || typeof reply !== 'object' || !('result' in reply) || !('files' in reply) || !Array.isArray(reply.files))
            throw new Error('Camera runtime returned no operation result')
        return { result: reply.result, files: reply.files, ...('images' in reply && Array.isArray(reply.images) && { images: reply.images }) }
    }
    async benchmark(camera: string): Promise<unknown> {
        return this.call(this.cameraPath(camera, 'benchmark'), {})
    }
}
