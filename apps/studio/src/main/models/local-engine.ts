import type { LocalServerProcess } from '@main/models/local-server'

/**
 * The lifecycle the assistant, speech and vision engines share: prepare starts the engine once (a
 * second caller waits for the same start), a prepare for another model first releases the one
 * loaded, release waits for a start under way and stops the process, and a prepare racing a release
 * waits for it rather than return the dying engine's port.
 */
export class LocalEngine<Key extends string = string> {
    private server: LocalServerProcess | null = null
    private loadedKey: Key | null = null
    private preparing: Promise<number> | null = null
    private releasing: Promise<void> | null = null

    constructor(
        private readonly hooks: {
            /** Downloads what `key` needs and starts its process; resolves once it answers. */
            start(key: Key): Promise<LocalServerProcess>
            /** Called after a release stopped the engine. */
            stopped(): void
        }
    ) {}

    /** The running engine's port, or null. */
    get port(): number | null {
        return this.server?.port ?? null
    }

    /** The model the running engine loaded. */
    get loaded(): Key | null {
        return this.loadedKey
    }

    async prepare(key: Key): Promise<number> {
        await this.releasing
        if (this.loadedKey && this.loadedKey !== key) await this.release()
        if (this.server?.port) return this.server.port
        this.preparing ??= (async () => {
            const server = await this.hooks.start(key)
            this.server = server
            this.loadedKey = key
            if (!server.port) throw new Error('The engine stopped as it started')
            return server.port
        })().finally(() => {
            this.preparing = null
        })
        return this.preparing
    }

    /** Stops the engine to give its memory back; downloads stay cached. */
    release(): Promise<void> {
        this.releasing ??= (async () => {
            await this.preparing?.catch(() => undefined)
            await this.server?.stop()
            this.server = null
            this.loadedKey = null
            this.hooks.stopped()
        })().finally(() => {
            this.releasing = null
        })
        return this.releasing
    }

    /** The process stopped by itself: the next prepare starts it again. */
    lost(): void {
        this.server = null
        this.loadedKey = null
    }
}
