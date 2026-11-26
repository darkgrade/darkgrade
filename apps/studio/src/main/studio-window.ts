import { preferences } from '@main/preferences'
import { rendererDocumentUrl } from '@main/renderer-security'
import { app, BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** The built main process's folder; the preload, renderer and icon sit beside it. */
export const mainDirectory = fileURLToPath(new URL('.', import.meta.url))

/** The one renderer document every Studio window loads (a window picks its view by hash). */
export const studioRendererUrl = rendererDocumentUrl(
    pathToFileURL(join(mainDirectory, '../renderer/index.html')).href,
    app.isPackaged,
    process.env.ELECTRON_RENDERER_URL
)

/** The renderer document at one hash route (`preferences`, `perf`). */
export function studioRouteUrl(route: string): string {
    const url = new URL(studioRendererUrl)
    url.hash = route
    return url.href
}

/**
 * A Studio window: on macOS the system's sidebar material and dimming (from Developer Mode ›
 * Appearance), elsewhere the dark background, and the sandboxed preload. It follows a material
 * change live, with a short fade, until it closes.
 */
export function createStudioWindow(options: BrowserWindowConstructorOptions): BrowserWindow {
    const window = new BrowserWindow({
        ...options,
        ...(process.platform === 'darwin'
            ? {
                  vibrancy: preferences.get().windowMaterial,
                  visualEffectState: preferences.get().dimWhenInactive
                      ? ('followWindow' as const)
                      : ('active' as const),
                  backgroundColor: '#00000000',
              }
            : { backgroundColor: '#07090b' }),
        webPreferences: {
            preload: join(mainDirectory, '../preload/index.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
        },
    })
    let material = preferences.get().windowMaterial
    const stopFollowingMaterial = preferences.onChange(current => {
        if (process.platform !== 'darwin' || current.windowMaterial === material) return
        material = current.windowMaterial
        if (!window.isDestroyed()) window.setVibrancy(material, { animationDuration: 200 })
    })
    window.on('closed', stopFollowingMaterial)
    return window
}
