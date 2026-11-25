import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

type VideoSetting = 'videoFormat' | 'videoQuality' | 'frameRate' | 'audioRecording'

/** The typed getter, or a skip when this camera has no such setting in its current mode. */
async function read(camera: Camera, report: SmokeReport, id: VideoSetting): Promise<string | undefined> {
    const getters = {
        videoFormat: () => camera.getVideoFormat(),
        videoQuality: () => camera.getVideoQuality(),
        frameRate: () => camera.getFrameRate(),
        audioRecording: () => camera.getAudioRecording(),
    }
    try {
        const value = await getters[id]()
        report.confirmed(`get${id[0]!.toUpperCase()}${id.slice(1)}`, value)
        return value
    } catch (error) {
        if (error instanceof CameraUnsupportedError) {
            report.skipped(id, error.message)
            return undefined
        }
        throw error
    }
}

/**
 * Writes another advertised value through setControl, confirms the readback, then writes the
 * original back through the typed setter and requires it to read back unchanged.
 */
async function changeAndRestore(camera: Camera, report: SmokeReport, id: 'videoFormat' | 'frameRate', original: string) {
    const control = (await camera.getCapabilities()).controls[id]
    if (!control?.writable) return report.skipped(`set ${id}`, `${id} is not writable in the current mode`)
    const alternative = control.allowedValues?.find(value => value !== original)
    if (!alternative) return report.skipped(`set ${id}`, 'the camera offers no other value')
    report.confirmed(`setControl('${id}', ${JSON.stringify(alternative)})`, (await camera.setControl(id, alternative)).value)
    const restored = id === 'frameRate' ? await camera.setControl('frameRate', original) : await camera.setControl('videoFormat', original)
    report.confirmed(`restore ${id} ${JSON.stringify(original)}`, restored.value)
    if (restored.value !== original) throw new Error(`${id} restored to ${restored.value}, not ${original}`)
    const typed = id === 'frameRate' ? await camera.getFrameRate() : await camera.getVideoFormat()
    if (typed !== original) throw new Error(`typed ${id} reads ${typed}, not ${original}`)
}

/** Video settings smoke steps: read all four, change and restore format and frame rate. */
export async function videoSettingsSmoke(camera: Camera, report: SmokeReport) {
    const format = await read(camera, report, 'videoFormat')
    await read(camera, report, 'videoQuality')
    const frameRate = await read(camera, report, 'frameRate')
    await read(camera, report, 'audioRecording')
    if (format) await changeAndRestore(camera, report, 'videoFormat', format)
    if (frameRate) await changeAndRestore(camera, report, 'frameRate', frameRate)
}
