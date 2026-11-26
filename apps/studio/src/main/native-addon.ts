import { app } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const loaded = new Map<string, unknown>()

/**
 * One of Studio's macOS add-ons (`native/<name>.node`, from Resources once packaged), loaded once.
 * Null on another platform or when it was not built on this machine; callers then use their fallback.
 */
export function loadNativeAddon<Addon>(name: string): Addon | null {
    if (loaded.has(name)) return loaded.get(name) as Addon | null
    let addon: Addon | null = null
    if (process.platform === 'darwin') {
        const file = app.isPackaged
            ? join(process.resourcesPath, 'native', `${name}.node`)
            : join(app.getAppPath(), 'native', 'build', `${name}.node`)
        try {
            addon = createRequire(import.meta.url)(file) as Addon
        } catch {
            // Not built on this machine.
        }
    }
    loaded.set(name, addon)
    return addon
}
