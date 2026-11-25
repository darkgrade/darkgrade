import { CameraUnsupportedError } from '@camera/errors'
import type { CameraControlState } from '@camera/controls'
import type { Camera } from '@camera/index'
import type { ShutterSpeed } from '@camera/settings/shutter-speed'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Sets a different advertised shutter speed, confirms the readback, then restores the original. */
async function shutterSpeed(camera: Camera, report: SmokeReport) {
    let original: ShutterSpeed
    try {
        original = await camera.getShutterSpeed()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped('getShutterSpeed', error.message)
        throw error
    }
    report.confirmed('getShutterSpeed', original)
    const control = (await camera.getCapabilities()).controls.shutterSpeed
    if (!control?.writable) return report.skipped('setShutterSpeed', 'shutter speed is not writable in the current mode')
    await changeAndRestoreShutterSpeed(camera, report, original, control)
}

/**
 * The smoke check, as an operation, may set up the mode it needs and restore it afterwards; a
 * setting write itself never changes the mode. Manual exposure makes shutter speed writable.
 */
async function withManualExposure(camera: Camera, report: SmokeReport, check: () => Promise<void>) {
    const mode = (await camera.getCapabilities()).controls.exposureProgram
    const manual = mode?.allowedValues?.find(value => /^manual$/i.test(value))
    if (!mode?.writable || !manual || mode.value === manual) return check()
    await camera.setControl('exposureProgram', manual)
    report.confirmed(`setup: setControl('exposureProgram', ${JSON.stringify(manual)})`, manual)
    try {
        await waitForWritableShutterSpeed(camera)
        await check()
    } finally {
        const restored = await camera.setControl('exposureProgram', mode.value)
        report.confirmed(`restore: setControl('exposureProgram', ${JSON.stringify(mode.value)})`, restored.value)
    }
}

/**
 * Bench finding (a7 V, firmware 1.00, 2026-11-24): right after ExposureProgramMode reads back
 * Manual, ShutterSpeed stays display-only (SDIO enable flag 2) for under 500 ms. Poll reads only.
 */
async function waitForWritableShutterSpeed(camera: Camera, timeoutMilliseconds = 3000) {
    const deadline = Date.now() + timeoutMilliseconds
    while (Date.now() < deadline) {
        if ((await camera.getCapabilities()).controls.shutterSpeed?.writable) return
        await new Promise(resolve => setTimeout(resolve, 100))
    }
}

async function changeAndRestoreShutterSpeed(
    camera: Camera,
    report: SmokeReport,
    original: ShutterSpeed,
    control: CameraControlState
) {
    const choices = control.allowedValues ?? []
    report.confirmed('getCapabilities().controls.shutterSpeed', {
        value: control.value,
        choices: choices.length,
        source: control.source.name,
    })
    const current = choices.indexOf(control.value)
    const alternative = choices[current > 0 ? current - 1 : current + 1]
    if (!alternative) return report.skipped('setShutterSpeed', 'the camera offers no other shutter speed')
    // The camera's own label goes through setControl; the typed setter takes the canonical spelling.
    const changed = await camera.setControl('shutterSpeed', alternative)
    report.confirmed(`setControl('shutterSpeed', ${JSON.stringify(alternative)})`, changed.value)
    report.confirmed('getShutterSpeed after change', await camera.getShutterSpeed())
    const restored = await camera.setShutterSpeed(original)
    report.confirmed(`setShutterSpeed(${JSON.stringify(original)})`, restored)
    if (restored !== original) throw new Error(`Shutter speed restored to ${restored}, not ${original}`)
}

export const settingsSmoke: SmokeArea = {
    name: 'settings',
    description: 'getCapabilities and the typed settings (shutterSpeed so far), restoring each value',
    async run(camera, report) {
        const capabilities = await camera.getCapabilities()
        report.confirmed('getCapabilities', {
            controls: Object.keys(capabilities.controls),
            advertisedOperations: capabilities.advertisedOperations?.length ?? null,
        })
        await withManualExposure(camera, report, () => shutterSpeed(camera, report))
    },
}
