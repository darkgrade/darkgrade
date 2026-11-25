import { CameraOutcomeUnknownError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { TypedSettingId } from '@camera/settings/typed-settings'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/**
 * Reads the typed value, writes a different advertised choice through setControl, reads it back
 * with the typed getter, then restores the original with the typed setter and checks it.
 */
async function changeAndRestore<Value extends string>(
    camera: Camera,
    report: SmokeReport,
    id: TypedSettingId,
    get: () => Promise<Value>,
    set: (value: Value) => Promise<Value>
) {
    let original: Value
    try {
        original = await get()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped(`get ${id}`, error.message)
        throw error
    }
    report.confirmed(`typed get ${id}`, original)
    const control = (await camera.getCapabilities()).controls[id]
    if (!control?.writable) return report.skipped(`set ${id}`, `${id} is not writable in the current mode`)
    const alternative = control.allowedValues?.find(value => value !== control.value)
    if (!alternative) return report.skipped(`set ${id}`, 'the camera offers no other choice')
    let changed
    try {
        changed = await camera.setControl(id, alternative)
    } catch (error) {
        if (!(error instanceof CameraOutcomeUnknownError)) throw error
        // Acknowledged but never shown: read again, and restore only if it did change.
        const now = await get()
        if (now !== original) {
            const restored = await set(original)
            report.confirmed(`restore after an unconfirmed write: set ${id}(${JSON.stringify(original)})`, restored)
            if (restored !== original) throw new Error(`${id} restored to ${restored}, not ${original}`)
        }
        return report.skipped(`setControl('${id}', ${JSON.stringify(alternative)})`, `unconfirmed (${error.message}); it still reads ${now}`)
    }
    report.confirmed(`setControl('${id}', ${JSON.stringify(alternative)})`, changed.value)
    report.confirmed(`typed get ${id} after change`, await get())
    const restored = await set(original)
    report.confirmed(`typed set ${id}(${JSON.stringify(original)})`, restored)
    if (restored !== original) throw new Error(`${id} restored to ${restored}, not ${original}`)
}

/** Photo settings smoke steps; every value changed is restored and checked. */
export async function photoSettingsSmoke(camera: Camera, report: SmokeReport) {
    await changeAndRestore(camera, report, 'photoFormat', () => camera.getPhotoFormat(), value => camera.setPhotoFormat(value))
    await changeAndRestore(camera, report, 'photoSize', () => camera.getPhotoSize(), value => camera.setPhotoSize(value))
    await changeAndRestore(camera, report, 'aspectRatio', () => camera.getAspectRatio(), value => camera.setAspectRatio(value))
    await changeAndRestore(camera, report, 'jpegQuality', () => camera.getJpegQuality(), value => camera.setJpegQuality(value))
    await changeAndRestore(camera, report, 'rawCompression', () => camera.getRawCompression(), value =>
        camera.setRawCompression(value)
    )
    await changeAndRestore(camera, report, 'flashMode', () => camera.getFlashMode(), value => camera.setFlashMode(value))
}
