import type { CameraControlId } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** One typed focus setting: its getter and setter, so the original value is restored through the typed API. */
interface TypedFocusSetting<Value extends string> {
    id: CameraControlId
    get(): Promise<Value>
    set(value: Value): Promise<Value>
}

/**
 * Reads the setting through its typed getter, writes a different advertised value through
 * setControl (the camera's own list), confirms the readback, then restores the original through
 * the typed setter and checks it read back.
 */
async function changeAndRestore<Value extends string>(camera: Camera, report: SmokeReport, setting: TypedFocusSetting<Value>) {
    let original: Value
    try {
        original = await setting.get()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped(`get ${setting.id}`, error.message)
        throw error
    }
    const control = (await camera.getCapabilities()).controls[setting.id]
    report.confirmed(`get ${setting.id}`, { value: original, choices: control?.allowedValues, source: control?.source.name })
    if (!control?.writable) return report.skipped(`set ${setting.id}`, `${setting.id} is not writable in the current mode`)
    const alternative = control.allowedValues?.find(value => value !== original)
    if (!alternative) return report.skipped(`set ${setting.id}`, 'the camera offers no other value')
    const changed = await camera.setControl(setting.id, alternative)
    report.confirmed(`setControl('${setting.id}', ${JSON.stringify(alternative)})`, changed.value)
    if (changed.value !== alternative) throw new Error(`${setting.id} read back ${changed.value}, not ${alternative}`)
    const restored = await setting.set(original)
    report.confirmed(`restore ${setting.id} → ${JSON.stringify(original)}`, restored)
    if (restored !== original) throw new Error(`${setting.id} restored to ${restored}, not ${original}`)
}

/** Focus settings smoke steps, each value restored: focus mode, area, subject detection, subject and eye. */
export async function focusSettingsSmoke(camera: Camera, report: SmokeReport) {
    await changeAndRestore(camera, report, {
        id: 'focusMode',
        get: () => camera.getFocusMode(),
        set: value => camera.setFocusMode(value),
    })
    await changeAndRestore(camera, report, {
        id: 'focusArea',
        get: () => camera.getFocusArea(),
        set: value => camera.setFocusArea(value),
    })
    await changeAndRestore(camera, report, {
        id: 'subjectDetection',
        get: () => camera.getSubjectDetection(),
        set: value => camera.setSubjectDetection(value),
    })
    await changeAndRestore(camera, report, {
        id: 'detectionSubject',
        get: () => camera.getDetectionSubject(),
        set: value => camera.setDetectionSubject(value),
    })
    await changeAndRestore(camera, report, {
        id: 'eyeSelection',
        get: () => camera.getEyeSelection(),
        set: value => camera.setEyeSelection(value),
    })
}
