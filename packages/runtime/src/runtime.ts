export const controlActions = [
    'status',
    'autofocus',
    'focus-near',
    'focus-far',
    'live-view-status',
    'set-focus-mode',
    'set-aperture',
    'set-shutter-speed',
    'set-iso',
    'set-white-balance',
    'set-color-temperature',
    'set-live-view-autofocus-mode',
    'set-image-format',
    'set-movie-format',
    'set-continuous-autofocus',
    'set-movie-servo-autofocus',
    'probe-movie-mode',
    'set-exposure-mode',
    'set-jpeg-quality',
    'set-image-size',
    'set-aspect-ratio',
    'set-movie-setting',
    'set-zoom-setting',
    'power-zoom-wide',
    'power-zoom-tele',
    'touch-focus',
    'set-property',
    'sync-clock',
] as const
export type ControlAction = (typeof controlActions)[number]
export const mediaActions = ['take-photo', 'latest-photo', 'live-view', 'storage', 'memory-status'] as const
export type MediaAction = (typeof mediaActions)[number]
export interface MediaOptions {
    autofocus?: boolean
    destination?: 'card' | 'memory'
    rawCompression?: 'lossless'
}
export interface CameraClient {
    control(camera: string, action: string, value?: string | number, property?: string): Promise<unknown>
    media(camera: string, action: string, options?: MediaOptions): Promise<unknown>
}
export interface ControlSession {
    supports(action: ControlAction): boolean
    control(action: ControlAction, value?: string | number): Promise<unknown>
}
/** Platform hosts supply connections and physical services, never a second MCP-owned session. */
export interface CameraProvider {
    session(camera: string): ControlSession | undefined
    assertControlAllowed(camera: string, action: ControlAction): void | Promise<void>
    control(camera: string, action: ControlAction, value?: string | number, property?: string): Promise<unknown>
    observeControls(camera: string, state: unknown): Promise<unknown>
    invalidate(camera: string, affectsImage: boolean): void
    media(camera: string, action: MediaAction, options: MediaOptions): Promise<unknown>
}
const imageActions = new Set([
    'set-iso',
    'set-aperture',
    'set-shutter-speed',
    'set-white-balance',
    'set-focus-mode',
    'autofocus',
    'touch-focus',
])

/**
 * One runtime per session-owning host. All frontends share its camera queue.
 * A rejected/abandoned client does not release ownership while a camera write runs.
 * Physical cross-process leases remain in the provider's shared ownership store.
 */
export class CameraRuntime implements CameraClient {
    private readonly operations = new Map<string, Promise<unknown>>()
    constructor(private readonly provider: CameraProvider) {}

    private async run<T>(camera: string, operation: () => Promise<T>): Promise<T> {
        if (typeof camera !== 'string' || !camera.trim()) throw new Error('A camera identity is required')
        const previous = this.operations.get(camera) ?? Promise.resolve()
        const pending = previous.catch(() => undefined).then(operation)
        this.operations.set(camera, pending)
        try {
            return await pending
        } finally {
            if (this.operations.get(camera) === pending) this.operations.delete(camera)
        }
    }

    control(camera: string, action: string, value?: string | number, property?: string): Promise<unknown> {
        if (!controlActions.includes(action as ControlAction))
            return Promise.reject(new Error(`Unknown camera control action ${action}`))
        const command = action as ControlAction
        return this.run(camera, async () => {
            await this.provider.assertControlAllowed(camera, command)
            // Resolve after queuing: the active transport/session may have changed.
            const session = this.provider.session(camera)
            if (session && !session.supports(command))
                throw new Error(`The active session cannot run ${command}; close its Console before retrying`)
            if (command !== 'status') this.provider.invalidate(camera, imageActions.has(command))
            const result = session?.supports(command)
                ? await session.control(command, value)
                : await this.provider.control(camera, command, value, property)
            return this.provider.observeControls(camera, result)
        })
    }

    async media(camera: string, action: string, options: MediaOptions = {}): Promise<unknown> {
        if (!mediaActions.includes(action as MediaAction))
            throw new Error(`Unsupported media action ${action}`)
        if (!options || typeof options !== 'object' || Array.isArray(options))
            throw new Error('Invalid photo options')
        const accepted = { ...options }
        if (accepted.autofocus !== undefined && typeof accepted.autofocus !== 'boolean')
            throw new Error('Invalid autofocus option')
        if (accepted.destination !== undefined && !['card', 'memory'].includes(accepted.destination))
            throw new Error('Invalid photo destination')
        if (accepted.rawCompression !== undefined && accepted.rawCompression !== 'lossless')
            throw new Error('Invalid RAW compression')
        return this.run(camera, () => this.provider.media(camera, action as MediaAction, accepted))
    }
}
