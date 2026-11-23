import { preferences } from '@main/preferences'
import type { DecodedSurface } from '@main/usb-experiments'
import { DECODED_FRAMES } from '@shared/ipc'
import { app, ipcMain, sharedTexture, type WebContents } from 'electron'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/**
 * Developer Mode's Metal live-view decoder (macOS): each live JPEG Slate delivers is decoded on the GPU by the native
 * add-on (native/metal-jpeg) and handed to the Studio window as a texture with Electron's sharedTexture, so the
 * window's WebGPU draws it without decoding anything. Off, or where the add-on isn't built or a frame can't be
 * decoded, the window gets the JPEG and decodes it itself, as always.
 *
 * A frame goes to the window one way, never both.
 */
interface MetalJpeg {
    decode(jpeg: Uint8Array): Promise<{ surface: Buffer; width: number; height: number } | null>
}

let addon: MetalJpeg | null | undefined
function loadAddon(): MetalJpeg | null {
    if (addon !== undefined) return addon
    addon = null
    if (process.platform !== 'darwin') return null
    const file = app.isPackaged
        ? join(process.resourcesPath, 'native', 'metal-jpeg.node')
        : join(app.getAppPath(), 'native', 'build', 'metal-jpeg.node')
    try {
        addon = createRequire(import.meta.url)(file) as MetalJpeg
    } catch {
        // Not built on this machine: frames go as JPEGs.
    }
    return addon
}

/** Windows whose page has registered to receive decoded frames. */
const ready = new WeakSet<WebContents>()
const consecutiveFailures = new WeakMap<WebContents, number>()
let inFlight = false

ipcMain.on(DECODED_FRAMES.Ready, event => {
    ready.add(event.sender)
    consecutiveFailures.delete(event.sender)
})
ipcMain.on(DECODED_FRAMES.Unavailable, event => ready.delete(event.sender))

/**
 * Sends a live frame to the window: as a texture the Metal decoder filled when that is switched on and the window
 * takes those, else as its JPEG through `sendJpeg`. A frame that arrives while the one before is still on its way is
 * skipped (the next replaces it); one the decoder fails on goes as its JPEG, so the picture never waits. Never
 * blocks the caller.
 */
export function sendLiveFrame(contents: WebContents, jpeg: Uint8Array, sendJpeg: (jpeg: Uint8Array) => void): void {
    const decoder = preferences.get().metalLiveViewDecoder && ready.has(contents) ? loadAddon() : null
    if (!decoder) return sendJpeg(jpeg)
    if (inFlight) return
    void sendAsTexture(decoder, contents, jpeg).then(sent => {
        if (sent) {
            consecutiveFailures.delete(contents)
            return
        }
        const failures = (consecutiveFailures.get(contents) ?? 0) + 1
        consecutiveFailures.set(contents, failures)
        if (failures >= DECODED_FRAMES.failuresBeforeJpeg) ready.delete(contents)
        if (!contents.isDestroyed()) sendJpeg(jpeg)
    })
}

/** True once the frame has been handed to the window; false when it couldn't be decoded or sent. */
async function sendAsTexture(decoder: MetalJpeg, contents: WebContents, jpeg: Uint8Array): Promise<boolean> {
    inFlight = true
    try {
        const decoded = await decoder.decode(jpeg)
        if (!decoded || contents.isDestroyed()) return false
        return await sendSurface(contents, decoded)
    } catch {
        return false
    } finally {
        inFlight = false
    }
}

/**
 * EXPERIMENT(usb-transport): a frame the Swift live-view loop already decoded goes to the window as a texture. Where
 * the window can't take it, `sendJpeg` sends the frame the usual way instead.
 */
export function sendDecodedSurface(contents: WebContents, decoded: DecodedSurface, sendJpeg: () => void): void {
    if (!ready.has(contents)) return sendJpeg()
    if (inFlight) return
    inFlight = true
    void sendSurface(contents, decoded)
        .catch(() => false)
        .then(sent => {
            inFlight = false
            if (!sent && !contents.isDestroyed()) sendJpeg()
        })
}

/** Hands a decoded surface to the window; true once the window's receiver has finished with it. */
async function sendSurface(
    contents: WebContents,
    decoded: { surface: Buffer; width: number; height: number }
): Promise<boolean> {
    const imported = sharedTexture.importSharedTexture({
        textureInfo: {
            // The camera's own 4:2:2 chroma, in the video-range layout Chromium's shared images take.
            pixelFormat: 'nv16',
            codedSize: { width: decoded.width, height: decoded.height },
            colorSpace: { primaries: 'bt709', transfer: 'srgb', matrix: 'smpte170m', range: 'limited' },
            handle: { ioSurface: decoded.surface },
        },
    })
    try {
        // Resolves when the window's receiver has finished with the frame, whether or not it could draw it.
        await sharedTexture.sendSharedTexture({ frame: contents.mainFrame, importedSharedTexture: imported })
    } finally {
        imported.release()
    }
    return true
}
