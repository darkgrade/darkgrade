import type { PreviewAssistsRequest } from '@renderer/scopes/PreviewAssists'
import { paintAssists, STRIPE_PIXELS } from '@renderer/scopes/preview-assists-painting'

let phase = 0

/** Decodes a preview frame off the main thread and answers with its zebra and peaking overlay. */
self.onmessage = async (event: MessageEvent<PreviewAssistsRequest>) => {
    try {
        const { frameUrl, settings } = event.data
        const bitmap = await createImageBitmap(await (await fetch(frameUrl)).blob())
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('No 2D context in the worker')
        context.drawImage(bitmap, 0, 0)
        bitmap.close()
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
        phase = (phase + 1) % (STRIPE_PIXELS * 2)
        const stripes = paintAssists(pixels, canvas.width, canvas.height, settings, phase)
        const overlay = new ImageData(new Uint8ClampedArray(stripes.buffer as ArrayBuffer), canvas.width, canvas.height)
        self.postMessage(overlay, { transfer: [overlay.data.buffer] })
    } catch {
        // The frame's blob URL was released before the worker read it: skip that frame.
        self.postMessage(null)
    }
}
