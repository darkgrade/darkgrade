import { HardwareBusyError } from './errors.ts'
import { validateMediaOptions, type CameraClient, type MediaOptions } from './runtime.ts'

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
    private async call(camera: string, endpoint: string, body: unknown): Promise<unknown> {
        if (typeof camera !== 'string' || !camera.trim() || camera === '.' || camera === '..')
            throw new Error('A valid camera identity is required')
        const url = new URL(`/api/cameras/${encodeURIComponent(camera)}/${endpoint}`, this.base)
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
    control(camera: string, action: string, value?: string | number, property?: string) {
        return this.call(camera, 'controls', { action, value, property })
    }
    async media(camera: string, action: string, options: MediaOptions = {}) {
        return this.call(camera, 'media-action', { ...validateMediaOptions(options, action), action })
    }
}
