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
 * the typed setter (also when the write failed) and checks it read back.
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
    try {
        const changed = await camera.setControl(setting.id, alternative)
        report.confirmed(`setControl('${setting.id}', ${JSON.stringify(alternative)})`, changed.value)
        if (changed.value !== alternative) throw new Error(`${setting.id} read back ${changed.value}, not ${alternative}`)
    } finally {
        await restore(report, setting, original)
    }
}

async function restore<Value extends string>(report: SmokeReport, setting: TypedFocusSetting<Value>, original: Value) {
    const restored = await setting.set(original)
    report.confirmed(`restore ${setting.id} → ${JSON.stringify(original)}`, restored)
    if (restored !== original) throw new Error(`${setting.id} restored to ${restored}, not ${original}`)
}

/**
 * The tracking spots whose names two Sony values share (Lock-on AF and the older Tracking Flexible
 * Spot), written by name and confirmed. Sony applies a tracking area only in AF-C: the a7 V
 * advertises them in AF-S but never reports a write there. Focus mode and area are restored.
 */
async function trackingSpots(camera: Camera, report: SmokeReport) {
    const step = 'tracking spots in AF-C'
    const controls = (await camera.getCapabilities()).controls
    const offered = (['Tracking Spot S', 'Tracking Spot M', 'Tracking Spot L', 'Tracking Expanded Spot'] as const).filter(
        spot => controls.focusArea?.allowedValues?.includes(spot)
    )
    if (!offered.length) return report.skipped(step, 'the camera offers no tracking spot')
    if (!controls.focusMode?.allowedValues?.includes('AF-C')) return report.skipped(step, 'the camera offers no AF-C')
    const originalMode = await camera.getFocusMode()
    const originalArea = await camera.getFocusArea()
    try {
        if (originalMode !== 'AF-C') report.confirmed("setFocusMode('AF-C')", await camera.setFocusMode('AF-C'))
        for (const spot of offered) {
            const written = await camera.setFocusArea(spot)
            report.confirmed(`setFocusArea('${spot}')`, written)
            if (written !== spot) throw new Error(`focusArea read back ${written}, not ${spot}`)
        }
    } finally {
        report.confirmed(`restore focusArea → ${JSON.stringify(originalArea)}`, await camera.setFocusArea(originalArea))
        if (originalMode !== 'AF-C')
            report.confirmed(`restore focusMode → ${JSON.stringify(originalMode)}`, await camera.setFocusMode(originalMode))
    }
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
    await trackingSpots(camera, report)
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
