import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { LiveViewQuality } from '@camera/settings/live-view'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Live-view settings: liveViewQuality, switched to the other advertised value and restored. */
export async function liveViewSettingsSmoke(camera: Camera, report: SmokeReport) {
    let original: LiveViewQuality
    try {
        original = await camera.getLiveViewQuality()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped('getLiveViewQuality', error.message)
        throw error
    }
    report.confirmed('getLiveViewQuality', original)
    const control = (await camera.getCapabilities()).controls.liveViewQuality
    report.confirmed('getCapabilities().controls.liveViewQuality', {
        value: control?.value,
        choices: control?.allowedValues,
        source: control?.source.name,
    })
    const alternative: LiveViewQuality = original === 'High' ? 'Low' : 'High'
    if (!control?.writable || !control.allowedValues?.includes(alternative))
        return report.skipped('setLiveViewQuality', 'the camera does not let live-view quality change now')
    report.confirmed(`setLiveViewQuality(${JSON.stringify(alternative)})`, await camera.setLiveViewQuality(alternative))
    const restored = await camera.setLiveViewQuality(original)
    report.confirmed(`setLiveViewQuality(${JSON.stringify(original)})`, restored)
    if (restored !== original) throw new Error(`Live-view quality restored to ${restored}, not ${original}`)
}
