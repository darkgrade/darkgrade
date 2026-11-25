import { CameraUnsupportedError } from '@camera/errors'
import type { CameraControlId, CameraControlState } from '@camera/controls'
import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** A typed setting's getter and setter, so each step runs through the public typed API. */
export interface TypedSettingSmoke<Value> {
    id: CameraControlId
    get: () => Promise<Value>
    set: (value: Value) => Promise<Value>
    /** The camera's advertised spelling of a choice, as the typed value. */
    parse: (choice: string) => Value
    /** Choices to try first, in order; otherwise the neighbour of the current value. */
    preferred?: readonly string[]
    /** Choices never to select in a smoke check. */
    avoid?: RegExp
}

/** Reads a setting, returning undefined (and reporting the skip) when this camera cannot right now. */
async function readOrSkip<Value>(setting: TypedSettingSmoke<Value>, report: SmokeReport): Promise<Value | undefined> {
    try {
        return await setting.get()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) {
            report.skipped(`get ${setting.id}`, error.message)
            return undefined
        }
        throw error
    }
}

function alternativeChoice(
    control: CameraControlState,
    setting: Pick<TypedSettingSmoke<unknown>, 'preferred' | 'avoid'>
): string | undefined {
    const choices = (control.allowedValues ?? []).filter(choice => choice !== control.value && !setting.avoid?.test(choice))
    const preferred = setting.preferred?.find(choice => choices.includes(choice))
    if (preferred) return preferred
    const all = control.allowedValues ?? []
    const index = all.indexOf(control.value)
    return [all[index + 1], all[index - 1], ...choices].find(choice => choice !== undefined && choices.includes(choice))
}

/**
 * Reads a typed setting, sets a different advertised value through its typed setter, confirms the
 * value read back, then restores the original. A setting this camera cannot change is a skip.
 */
export async function changeAndRestore<Value>(camera: Camera, report: SmokeReport, setting: TypedSettingSmoke<Value>) {
    const original = await readOrSkip(setting, report)
    if (original === undefined) return
    report.confirmed(`get ${setting.id}`, original)
    const control = (await camera.getCapabilities()).controls[setting.id]
    if (!control?.writable) return report.skipped(`set ${setting.id}`, `${setting.id} is not writable in the current mode`)
    report.confirmed(`getCapabilities().controls.${setting.id}`, {
        value: control.value,
        choices: control.allowedValues ?? control.range ?? null,
        source: control.source.name,
    })
    const alternative = alternativeChoice(control, setting)
    if (alternative === undefined) return report.skipped(`set ${setting.id}`, 'the camera offers no other value')
    let changed = false
    try {
        changed = true
        const confirmed = await setting.set(setting.parse(alternative))
        report.confirmed(`set ${setting.id}(${JSON.stringify(alternative)})`, confirmed)
        if (String(confirmed) !== alternative) throw new Error(`${setting.id} read back ${String(confirmed)}, not ${alternative}`)
    } finally {
        if (changed) {
            const restored = await setting.set(original)
            report.confirmed(`restore ${setting.id}(${JSON.stringify(original)})`, restored)
            if (restored !== original) throw new Error(`${setting.id} restored to ${String(restored)}, not ${String(original)}`)
        }
    }
}

/** Kelvin needs the white balance at Color Temperature; the check sets that up and restores it. */
async function colorTemperature(camera: Camera, report: SmokeReport) {
    const kelvin: TypedSettingSmoke<number> = {
        id: 'colorTemperature',
        get: () => camera.getColorTemperature(),
        set: value => camera.setColorTemperature(value),
        parse: Number,
    }
    const control = (await camera.getCapabilities()).controls.colorTemperature
    const balance = (await camera.getCapabilities()).controls.whiteBalance
    if (control?.writable || !balance?.writable || !balance.allowedValues?.includes('Color Temperature'))
        return kelvinStep(camera, report, kelvin)
    const original = await camera.getWhiteBalance()
    report.confirmed(`setup: setWhiteBalance('Color Temperature')`, await camera.setWhiteBalance('Color Temperature'))
    try {
        await waitForWritable(camera, 'colorTemperature')
        await kelvinStep(camera, report, kelvin)
    } finally {
        report.confirmed(`restore: setWhiteBalance(${JSON.stringify(original)})`, await camera.setWhiteBalance(original))
    }
}

/** A ranged colour temperature moves one step; an enumerated one uses its choices. */
async function kelvinStep(camera: Camera, report: SmokeReport, kelvin: TypedSettingSmoke<number>) {
    const control = (await camera.getCapabilities()).controls.colorTemperature
    if (!control?.range || control.allowedValues?.length) return changeAndRestore(camera, report, kelvin)
    const original = await kelvin.get()
    report.confirmed('get colorTemperature', original)
    const { minimum, maximum, step } = control.range
    // About 100 K, in whole steps of the camera's range.
    const stepKelvin = step > 0 ? Math.max(1, Math.round(100 / step)) * step : 100
    const target = original + stepKelvin <= maximum ? original + stepKelvin : original - stepKelvin
    if (target < minimum) return report.skipped('set colorTemperature', 'the range has no other value')
    try {
        report.confirmed(`set colorTemperature(${target})`, await kelvin.set(target))
    } finally {
        report.confirmed(`restore colorTemperature(${original})`, await kelvin.set(original))
    }
}

/** Polls reads only, until a control the camera just enabled reports writable. */
export async function waitForWritable(camera: Camera, id: CameraControlId, timeoutMilliseconds = 3000) {
    const deadline = Date.now() + timeoutMilliseconds
    while (Date.now() < deadline) {
        if ((await camera.getCapabilities()).controls[id]?.writable) return
        await new Promise(resolve => setTimeout(resolve, 100))
    }
}

/** Colour settings smoke steps: white balance, colour temperature, look, picture profile, each restored. */
export async function colourSettingsSmoke(camera: Camera, report: SmokeReport) {
    await changeAndRestore(camera, report, {
        id: 'whiteBalance',
        get: () => camera.getWhiteBalance(),
        set: value => camera.setWhiteBalance(value),
        parse: choice => choice as Awaited<ReturnType<Camera['getWhiteBalance']>>,
        preferred: ['Daylight', 'Shade', 'Auto'],
    })
    await colorTemperature(camera, report)
    await changeAndRestore(camera, report, {
        id: 'pictureStyle',
        get: () => camera.getPictureStyle(),
        set: value => camera.setPictureStyle(value),
        parse: choice => choice as Awaited<ReturnType<Camera['getPictureStyle']>>,
        preferred: ['Portrait', 'Neutral', 'Standard'],
    })
    await changeAndRestore(camera, report, {
        id: 'pictureProfile',
        get: () => camera.getPictureProfile(),
        set: value => camera.setPictureProfile(value),
        parse: choice => choice as Awaited<ReturnType<Camera['getPictureProfile']>>,
        preferred: ['Off', 'PP1'],
    })
}
