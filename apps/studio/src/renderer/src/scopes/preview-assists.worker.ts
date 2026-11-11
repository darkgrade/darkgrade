import type { PreviewAssistsMessage } from '@renderer/scopes/PreviewAssists'
import { paintAssists, STRIPE_PIXELS } from '@renderer/scopes/preview-assists-painting'

let phase = 0
/** The overlay canvas, handed over by the window: this worker draws on it directly. */
let target: OffscreenCanvas | null = null

/**
 * Decodes a preview frame, works out its zebra and peaking overlay and draws it onto the overlay
 * canvas, all off the main thread; the window only learns that the frame is done.
 */
self.onmessage = async (event: MessageEvent<PreviewAssistsMessage>) => {
    const message = event.data
    if (message.type === 'canvas') {
        target = message.canvas
        return
    }
    try {
        const { frameUrl, settings } = message
        const bitmap = await createImageBitmap(await (await fetch(frameUrl)).blob())
        const reader = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = reader.getContext('2d', { willReadFrequently: true })
        if (!context || !target) throw new Error('No canvas to draw on')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const pixels = context.getImageData(0, 0, reader.width, reader.height).data
        phase = (phase + 1) % (STRIPE_PIXELS * 2)
        const stripes = paintAssists(pixels, reader.width, reader.height, settings, phase)
        if (target.width !== reader.width || target.height !== reader.height) {
            target.width = reader.width
            target.height = reader.height
        }
        target.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(stripes.buffer as ArrayBuffer), reader.width, reader.height), 0, 0)
    } catch {
        // The frame's blob URL was released before the worker read it: skip that frame.
    }
    self.postMessage('done')
}
