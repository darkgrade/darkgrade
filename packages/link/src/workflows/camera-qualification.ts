/** Portable, deliberately small control contracts. Never export arbitrary camera properties. */
export const qualificationSettings = ['iso', 'aperture', 'shutterSpeed', 'whiteBalance'] as const
export type QualificationSetting = typeof qualificationSettings[number]
type Value = string | number
export interface QualificationControl {
    value?: Value
    writable?: boolean
    enabled?: boolean
    access?: string
    allowedValues?: Value[]
}
export interface QualificationCamera {
    read(): Promise<{ controls?: Partial<Record<QualificationSetting, QualificationControl>> }>
    set(setting: QualificationSetting, value: Value): Promise<unknown>
}
const scalar = (value: unknown): value is Value =>
    typeof value === 'string' && value.length <= 200 || typeof value === 'number' && Number.isFinite(value)
export function qualificationValue(setting: QualificationSetting, value: Value): string {
    const text = String(value).trim()
    if (setting === 'iso') return text.replace(/^iso\s+/i, '').toLowerCase()
    if (setting === 'aperture') {
        const aperture = Number(text.replace(/^f\/?/i, ''))
        if (Number.isFinite(aperture)) return String(aperture)
    }
    return text.toLowerCase()
}
export function cameraControlContract(state: Awaited<ReturnType<QualificationCamera['read']>>) {
    return Object.fromEntries(qualificationSettings.map(setting => {
        const control = state.controls?.[setting]
        const choices = (control?.allowedValues || []).filter(scalar).slice(0, 512)
        const writable = control?.enabled !== false &&
            (control?.writable === true || control?.writable === undefined && control?.access === 'GetSet')
        return [setting, {
            present: Boolean(control), writable, ...(scalar(control?.value) && { value: control.value }),
            choices,
            status: !control ? 'absent' : !writable ? 'read-only-in-current-mode' :
                choices.length < 2 ? 'no-alternative-advertised' : 'ready',
        }]
    }))
}
/** Caller owns the camera throughout. A failed/ambiguous write still triggers restoration. */
export async function qualifyCameraSetting(camera: QualificationCamera, setting: QualificationSetting, target: Value) {
    if (!qualificationSettings.includes(setting) || !scalar(target)) throw new Error('Invalid qualification setting or target')
    const initial = cameraControlContract(await camera.read())[setting]!
    const original = initial.value
    const matches = (left: Value, right: Value) => qualificationValue(setting, left) === qualificationValue(setting, right)
    if (!scalar(original) || !initial.writable) throw new Error('Setting is not currently readable and writable')
    const advertised = initial.choices.find(value => matches(value, target))
    if (advertised === undefined || !initial.choices.some(value => matches(value, original)))
        throw new Error('Both target and original must be advertised before qualification')
    if (matches(original, advertised)) throw new Error('Choose a different value to exercise the setter')
    const report: {
        setting: QualificationSetting; original: Value; target: Value; observed?: Value; restoredValue?: Value
        passed: boolean; restored: boolean; error?: string; restorationError?: string
    } = { setting, original, target: advertised, passed: false, restored: false }
    try {
        await camera.set(setting, advertised)
        const observed = (await camera.read()).controls?.[setting]?.value
        if (scalar(observed)) report.observed = observed
        report.passed = scalar(observed) && matches(observed, advertised)
        if (!report.passed) report.error = 'Fresh camera readback did not match the target'
    } catch (error) {
        report.error = error instanceof Error ? error.message : String(error)
    } finally {
        try {
            await camera.set(setting, original)
            const restored = (await camera.read()).controls?.[setting]?.value
            if (scalar(restored)) report.restoredValue = restored
            report.restored = scalar(restored) && matches(restored, original)
            if (!report.restored) report.restorationError = 'Fresh camera readback did not match the original'
        } catch (error) {
            report.restorationError = error instanceof Error ? error.message : String(error)
        }
    }
    report.passed &&= report.restored && !report.error
    return report
}
