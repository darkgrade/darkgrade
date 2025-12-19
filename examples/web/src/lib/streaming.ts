import type { Camera } from '@camera/index'
import { cameraQueue } from './queue'
import { store } from './store.svelte'

export const startStreaming = () => {
    store.streaming = true
}

export const stopStreaming = () => {
    store.streaming = false

    if (store.animationFrame) {
        cancelAnimationFrame(store.animationFrame)
        store.animationFrame = null
    }

    store.fps = 0
    store.resolution = null
    store.frameTimestamps = []
}

export const streamFrame = async (camera: Camera, ctx: CanvasRenderingContext2D) => {
    if (!store.streaming || !camera || !store.connected || !store.canvasRef) return

    try {
        const newSettings = await cameraQueue.push(async () => {
            try {
                return {
                    aperture: await camera.getAperture(),
                    shutterSpeed: await camera.getShutterSpeed(),
                    iso: await camera.getIso(),
                }
            } catch (error) {
                // Properties not supported on this camera
                return {}
            }
        })

        // Track which properties changed (only if we have settings)
        if (store.previousSettings && Object.keys(newSettings).length > 0) {
            const changed = new Set<string>()
            if (store.previousSettings.aperture !== newSettings.aperture) changed.add('aperture')
            if (store.previousSettings.shutterSpeed !== newSettings.shutterSpeed) changed.add('shutterSpeed')
            if (store.previousSettings.iso !== newSettings.iso) changed.add('iso')

            if (changed.size > 0) {
                store.changedProps = changed

                setTimeout(() => {
                    store.changedProps = new Set()
                }, 1000)
            }
        }

        store.previousSettings = newSettings
        store.settings = newSettings

        const result = await cameraQueue.push(async () => await camera.captureLiveView())
        if (result && store.streaming) {
            // Decode JPEG binary data directly to ImageBitmap (no URLs!)
            const blob = new Blob([new Uint8Array(result)], { type: 'image/jpeg' })
            const imageBitmap = await createImageBitmap(blob)

            // Set canvas dimensions to match image
            store.canvasRef.width = imageBitmap.width
            store.canvasRef.height = imageBitmap.height

            // Update resolution state
            store.resolution = {
                width: imageBitmap.width,
                height: imageBitmap.height,
            }

            // Draw ImageBitmap directly to canvas
            ctx.drawImage(imageBitmap, 0, 0)

            // Clean up ImageBitmap resources
            imageBitmap.close()

            // Calculate FPS
            const now = performance.now()
            store.frameTimestamps.push(now)

            // Keep only last 30 frame timestamps for rolling average
            if (store.frameTimestamps.length > 30) {
                store.frameTimestamps.shift()
            }

            if (store.frameTimestamps.length >= 2) {
                const timeSpan = store.frameTimestamps[store.frameTimestamps.length - 1] - store.frameTimestamps[0]
                const currentFps = Math.round(((store.frameTimestamps.length - 1) * 1000) / timeSpan)
                store.fps = currentFps
            }

            // Schedule next frame
            if (store.streaming) {
                store.animationFrame = requestAnimationFrame(() => streamFrame(camera, ctx))
            }
        }
    } catch (error) {
        if (error instanceof DOMException && error.name === 'InvalidStateError') {
            // live view frame is invalid, camera was not ready (>30fps) so ignore
        } else {
            console.error('Error capturing live view:', error)
        }
        if (store.streaming) {
            store.animationFrame = requestAnimationFrame(() => streamFrame(camera, ctx))
        }
    }
}
