import { CameraUnsupportedError } from '@camera/errors'
import { SonyCamera } from '@camera/sony-camera'
import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'

const JPEG_START = [0xff, 0xd8]
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]
const startsWith = (bytes: Uint8Array, prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
const PACED_SECONDS = 3

export const liveViewSmoke: SmokeArea = {
    name: 'live-view',
    description: 'getLiveViewFrame: JPEG, focus frames, pacing over a few seconds, and the camera overlay',
    async run(camera, report) {
        const support = (await camera.getCapabilities()).operations?.getLiveViewFrame
        report.confirmed('getCapabilities().operations.getLiveViewFrame', support ?? 'not reported')
        if (support && !support.supported) return report.skipped('getLiveViewFrame', support.reason ?? 'unsupported')

        const first = await camera.getLiveViewFrame()
        if (!startsWith(first.jpeg, JPEG_START)) throw new Error('The live-view frame is not a JPEG')
        report.confirmed('getLiveViewFrame()', {
            jpegBytes: first.jpeg.length,
            focusFrames: first.focusFrames.map(({ kind, focused, centerX, centerY, width, height }) => ({
                kind,
                focused,
                centre: [Number(centerX.toFixed(3)), Number(centerY.toFixed(3))],
                size: [Number(width.toFixed(3)), Number(height.toFixed(3))],
            })),
        })

        // Pacing: back-to-back calls never ask faster than the camera makes frames.
        const startedMs = performance.now()
        let frames = 0
        while (performance.now() - startedMs < PACED_SECONDS * 1000) {
            await camera.getLiveViewFrame()
            frames++
        }
        const seconds = (performance.now() - startedMs) / 1000
        report.confirmed(
            `getLiveViewFrame() back to back for ${PACED_SECONDS} s`,
            `${(frames / seconds).toFixed(1)} fps`
        )

        if (support?.options?.overlay && !support.options.overlay.supported)
            return report.skipped(
                'getLiveViewFrame({ overlay: true })',
                support.options.overlay.reason ?? 'unsupported'
            )
        try {
            const withOverlay = await camera.getLiveViewFrame({ overlay: true })
            const overlay = withOverlay.overlay?.png
            if (!overlay || !startsWith(overlay, PNG_SIGNATURE)) throw new Error('The overlay is not a PNG')
            report.confirmed('getLiveViewFrame({ overlay: true })', {
                jpegBytes: withOverlay.jpeg.length,
                pngBytes: overlay.length,
            })
        } catch (error) {
            if (error instanceof CameraUnsupportedError)
                return report.skipped('getLiveViewFrame({ overlay: true })', error.message)
            throw error
        }
        // Overlays stop: after the idle period the next frame switches the camera's overlay output off.
        await new Promise(resolve => setTimeout(resolve, 2_500))
        const after = await camera.getLiveViewFrame()
        report.confirmed('getLiveViewFrame() after overlays stop', { overlay: after.overlay ? 'present' : 'none' })
        const driver = camera.getInstance()
        if (!(driver instanceof SonyCamera)) return
        // The output switch is private to Slate; this check reads it back from a fresh inventory.
        await camera.getCapabilities()
        const output = driver.listPropertyStates().find(state => state.name === 'OsdImageMode')?.value
        if (output !== 'OFF') throw new Error(`The camera's overlay output read back ${String(output)}, not OFF`)
        report.confirmed("camera's overlay output after overlays stop (read back)", output)
    },
}
