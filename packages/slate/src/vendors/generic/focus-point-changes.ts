import type { CameraInfo } from '@camera/driver'

/** One setting a focus point changed: the value it replaced and the value it left on the body. */
interface FocusPointChange {
    original: string
    placed: string
}

type Changes = Map<string, FocusPointChange>

/** Each body's changes, by make, model and serial number, for the life of the process. */
const changesByBody = new Map<string, Changes>()

/**
 * What setFocusPoint changed so the point could be placed (the focus area it switched from, the
 * subject detection it paused), so resetFocusPoint and disconnect can put it back. The record belongs
 * to the body, not the session or the Camera object: once the body has been identified by its serial
 * number, a later session or a new Camera on the same body (a host that opens one per call, or a
 * session that ended without a clean disconnect) still finds it. A change is undone only while the
 * body still shows the value Slate left, so anything chosen on the camera or with a setter since stays.
 */
export class FocusPointChanges {
    #changes: Changes = new Map()

    /** Joins this body's record; a body without a serial number keeps its record on this object only. */
    identify(info: Pick<CameraInfo, 'manufacturer' | 'model' | 'serialNumber'>): void {
        if (!info.serialNumber) return
        const key = `${info.manufacturer}\u0000${info.model}\u0000${info.serialNumber}`
        const shared = changesByBody.get(key) ?? new Map()
        if (shared === this.#changes) return
        for (const [setting, change] of this.#changes)
            shared.set(setting, { original: shared.get(setting)?.original ?? change.original, placed: change.placed })
        changesByBody.set(key, shared)
        this.#changes = shared
    }

    /**
     * Records that `setting` went from `from` to `placed`. Where `from` is what an earlier change left,
     * the value from before that change is the one kept.
     */
    changed(setting: string, from: string, placed: string): void {
        const earlier = this.#changes.get(setting)
        this.#changes.set(setting, { original: earlier?.placed === from ? earlier.original : from, placed })
    }

    /** Drops a change: the setting was chosen since, so it is no longer Slate's to undo. */
    forget(setting: string): void {
        this.#changes.delete(setting)
    }

    get empty(): boolean {
        return this.#changes.size === 0
    }

    /**
     * The steps that put each changed setting back, in the order the changes were made, where the body still shows
     * the value Slate left. A change is dropped before its write, so a failed write is never repeated.
     */
    restoreSteps(
        read: (setting: string) => Promise<string | undefined>,
        write: (setting: string, value: string) => Promise<void>
    ): (() => Promise<void>)[] {
        return [...this.#changes.entries()].map(([setting, { original, placed }]) => async () => {
            this.#changes.delete(setting)
            if ((await read(setting)) === placed) await write(setting, original)
        })
    }
}
