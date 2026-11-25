import type { CameraControlId } from '@camera/controls'
import { CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

type ExposureId = Extract<
    CameraControlId,
    'shutterSpeed' | 'aperture' | 'iso' | 'exposureMode' | 'exposureCompensation' | 'meteringMode'
>

/** One exposure setting's typed accessors, so each check reads and restores through them. */
interface TypedSetting<Value extends string> {
    id: ExposureId
    get(): Promise<Value>
    set(value: Value): Promise<Value>
}

const settings = (camera: Camera) => ({
    shutterSpeed: {
        id: 'shutterSpeed',
        get: () => camera.getShutterSpeed(),
        set: value => camera.setShutterSpeed(value),
    } satisfies TypedSetting<Awaited<ReturnType<Camera['getShutterSpeed']>>>,
    aperture: {
        id: 'aperture',
        get: () => camera.getAperture(),
        set: value => camera.setAperture(value),
    } satisfies TypedSetting<Awaited<ReturnType<Camera['getAperture']>>>,
    iso: {
        id: 'iso',
        get: () => camera.getIso(),
        set: value => camera.setIso(value),
    } satisfies TypedSetting<Awaited<ReturnType<Camera['getIso']>>>,
    exposureCompensation: {
        id: 'exposureCompensation',
        get: () => camera.getExposureCompensation(),
        set: value => camera.setExposureCompensation(value),
    } satisfies TypedSetting<Awaited<ReturnType<Camera['getExposureCompensation']>>>,
    meteringMode: {
        id: 'meteringMode',
        get: () => camera.getMeteringMode(),
        set: value => camera.setMeteringMode(value),
    } satisfies TypedSetting<Awaited<ReturnType<Camera['getMeteringMode']>>>,
})

const getterName = (id: string) => `get${id.charAt(0).toUpperCase()}${id.slice(1)}`
const setterName = (id: string) => `set${id.charAt(0).toUpperCase()}${id.slice(1)}`

async function readTyped<Value extends string>(report: SmokeReport, setting: TypedSetting<Value>) {
    try {
        const value = await setting.get()
        report.confirmed(getterName(setting.id), value)
        return value
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped(getterName(setting.id), error.message)
        throw error
    }
}

/**
 * Sets a neighbouring advertised value through setControl (the camera's choices are canonical
 * names), confirms the typed getter reads it back, then restores the original through the typed
 * setter and checks the restore read back exactly.
 */
async function changeAndRestore<Value extends string>(camera: Camera, report: SmokeReport, setting: TypedSetting<Value>) {
    // Wait first: right after a mode change the a7 V still reports the previous mode's metered
    // value (0.4" in Aperture priority) until the control turns writable with its own (1/40).
    const writable = await waitForWritable(camera, setting.id)
    const original = await readTyped(report, setting)
    if (original === undefined) return
    if (!writable) return report.skipped(setterName(setting.id), `${setting.id} is not writable in the current mode`)
    const control = (await camera.getCapabilities()).controls[setting.id]
    if (!control?.writable) return report.skipped(setterName(setting.id), `${setting.id} is not writable in the current mode`)
    const settled = await setting.get()
    if (settled !== original)
        throw new Error(`${setting.id} read ${original} and then ${settled}; refusing to restore an unsettled value`)
    const choices = control.allowedValues ?? []
    report.confirmed(`getCapabilities().controls.${setting.id}`, {
        value: control.value,
        choices,
        source: control.source.name,
    })
    const current = choices.indexOf(control.value)
    const alternative = choices[current > 0 ? current - 1 : current + 1]
    if (!alternative) return report.skipped(setterName(setting.id), `the camera offers no other ${setting.id}`)
    try {
        const changed = await camera.setControl(setting.id, alternative)
        report.confirmed(`setControl('${setting.id}', ${JSON.stringify(alternative)})`, changed.value)
        if (changed.value !== alternative) throw new Error(`${setting.id} read back ${changed.value}, not ${alternative}`)
        report.confirmed(`${getterName(setting.id)} after change`, await setting.get())
    } finally {
        const restored = await setting.set(original)
        report.confirmed(`${setterName(setting.id)}(${JSON.stringify(original)})`, restored)
        if (restored !== original) throw new Error(`${setting.id} restored to ${restored}, not ${original}`)
    }
}

/**
 * Bench finding (a7 V, firmware 1.00, 2026-11-24): right after ExposureProgramMode reads back
 * Manual, ShutterSpeed stays display-only (SDIO enable flag 2) for under 500 ms. Poll reads only.
 */
async function waitForWritable(camera: Camera, id: ExposureId, timeoutMilliseconds = 3000) {
    const deadline = Date.now() + timeoutMilliseconds
    for (;;) {
        const control = (await camera.getCapabilities()).controls[id]
        if (control?.writable) return control
        if (!control || Date.now() >= deadline) return undefined
        await new Promise(resolve => setTimeout(resolve, 100))
    }
}

/** A value the camera never offers is refused before anything is sent. */
async function refusedIso(camera: Camera, report: SmokeReport) {
    const control = (await camera.getCapabilities()).controls.iso
    if (!control?.writable) return report.skipped('setIso (refused)', 'ISO is not writable in the current mode')
    const before = await camera.getIso()
    const refused = await camera.setIso('ISO 3').catch((error: unknown) => error)
    if (!(refused instanceof CameraRefusedError)) throw new Error(`setIso('ISO 3') was not refused: ${String(refused)}`)
    const after = await camera.getIso()
    if (after !== before) throw new Error(`A refused ISO changed the camera from ${before} to ${after}`)
    report.confirmed(`setIso('ISO 3') refused, unchanged`, { error: refused.name, iso: after })
}

/**
 * The smoke check, as an operation, may set up the mode it needs and restore it afterwards; a
 * setting write itself never changes the mode. Manual exposure makes shutter, aperture and ISO
 * writable. The mode-dial letter `M` is used for the setup, the word for the restore.
 */
async function withManualExposure(camera: Camera, report: SmokeReport, check: () => Promise<void>) {
    const original = await readTyped(report, { id: 'exposureMode', get: () => camera.getExposureMode(), set: value => camera.setExposureMode(value) })
    const mode = (await camera.getCapabilities()).controls.exposureMode
    report.confirmed('getCapabilities().controls.exposureMode', {
        value: mode?.value,
        choices: mode?.allowedValues,
        source: mode?.source.name,
    })
    if (!original || !mode?.writable || !mode.allowedValues?.includes('Manual') || original === 'Manual') return check()
    report.confirmed(`setup: setExposureMode('M')`, await camera.setExposureMode('M'))
    try {
        await check()
    } finally {
        const restored = await camera.setExposureMode(original)
        report.confirmed(`restore: setExposureMode(${JSON.stringify(original)})`, restored)
        if (restored !== original) throw new Error(`Exposure mode restored to ${restored}, not ${original}`)
    }
}

/** Switches to another advertised exposure mode through its alias and back, if one is offered. */
async function exposureModeRoundTrip(camera: Camera, report: SmokeReport) {
    const mode = await waitForWritable(camera, 'exposureMode')
    if (!mode) return report.skipped('setExposureMode', 'exposure mode is not writable in the current mode')
    const original = await camera.getExposureMode()
    const target = (['Aperture priority', 'Shutter priority', 'Program'] as const).find(
        candidate => candidate !== original && mode.allowedValues?.includes(candidate)
    )
    if (!target) return report.skipped('setExposureMode', 'the camera offers no other exposure mode')
    const alias = ({ 'Aperture priority': 'A', 'Shutter priority': 'S', Program: 'P' } as const)[target]
    try {
        report.confirmed(`setExposureMode('${alias}')`, await camera.setExposureMode(alias))
    } finally {
        const restored = await camera.setExposureMode(original)
        report.confirmed(`setExposureMode(${JSON.stringify(original)})`, restored)
        if (restored !== original) throw new Error(`Exposure mode restored to ${restored}, not ${original}`)
    }
}

/** Exposure settings smoke steps: every typed exposure setting, each value restored. */
export async function exposureSettingsSmoke(camera: Camera, report: SmokeReport) {
    const typed = settings(camera)
    // Compensation and metering are checked in the operator's own mode; Manual may lock compensation.
    await changeAndRestore(camera, report, typed.exposureCompensation)
    await changeAndRestore(camera, report, typed.meteringMode)
    await exposureModeRoundTrip(camera, report)
    await withManualExposure(camera, report, async () => {
        await changeAndRestore(camera, report, typed.shutterSpeed)
        await changeAndRestore(camera, report, typed.aperture)
        await changeAndRestore(camera, report, typed.iso)
        await refusedIso(camera, report)
    })
}
