import { HardwareBusyError } from './errors.ts'
import type { CameraClient, MediaOptions } from './runtime.ts'

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
            if (error instanceof Error && error.name === 'TimeoutError')
                throw new Error(
                    'Runtime request timed out; the camera operation may still be running. Inspect the host before retrying.'
                )
            throw error
        }
        const result = (await response.json()) as { error?: string; code?: string }
        if (response.status === 409 && result.code === 'HARDWARE_BUSY')
            throw new HardwareBusyError(result.error || 'Camera is busy')
        if (!response.ok) throw new Error(result.error || `Camera request failed (${response.status})`)
        return result
    }
    control(camera: string, action: string, value?: string | number, property?: string) {
        return this.call(camera, 'controls', { action, value, property })
    }
    media(camera: string, action: string, options: MediaOptions = {}) {
        return this.call(camera, 'media-action', { action, ...options })
    }
}
