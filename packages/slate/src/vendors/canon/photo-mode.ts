import type { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraUnsupportedError } from '@camera/errors'

/** What photo-mode preparation needs from the Canon driver. */
export type CanonPhotoModeDriver = Pick<
    CanonCamera,
    | 'listUnknownPropertyStates'
    | 'listPropertyStates'
    | 'leaveMovieMode'
    | 'enterMovieMode'
    | 'setManualExposureMode'
    | 'setIso'
    | 'setAperture'
    | 'setShutterSpeed'
    | 'setWhiteBalance'
>

const MODE_SETTLE_MILLISECONDS = 700
const MANUAL_EXPOSURE_MODE = 3

/** The manual settings a movie-select transition can reset, and the driver setter for each. */
const exposureSettings = [
    ['CanonIso', 'setIso'],
    ['CanonAperture', 'setAperture'],
    ['CanonShutterSpeed', 'setShutterSpeed'],
    ['CanonWhiteBalance', 'setWhiteBalance'],
] as const

type ExposureSnapshot = { mode: number; values: Map<string, string> }

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

function inMovieMode(driver: CanonPhotoModeDriver): boolean {
    return driver.listUnknownPropertyStates().some(state => state.name === 'FixedMovie' && state.rawValue === 1)
}

function readSetting(driver: CanonPhotoModeDriver, name: string) {
    return driver.listPropertyStates().find(state => state.name === name)
}

function snapshot(driver: CanonPhotoModeDriver): ExposureSnapshot {
    const values = new Map<string, string>()
    for (const [name] of exposureSettings) {
        const value = readSetting(driver, name)?.value
        if (value !== undefined) values.set(name, String(value))
    }
    return { mode: Number(readSetting(driver, 'CanonAutoExposureMode')?.value), values }
}

/** Movie-select On/Off can reset manual exposure to the dial; put back each advertised value and verify it. */
async function restoreExposure(driver: CanonPhotoModeDriver, before: ExposureSnapshot) {
    if (before.mode !== MANUAL_EXPOSURE_MODE) return
    await driver.setManualExposureMode()
    for (const [name, setter] of exposureSettings) {
        const value = before.values.get(name)
        if (value === undefined) continue
        const state = readSetting(driver, name)
        if (String(state?.value) === value) continue
        if (!state?.allowedValues?.map(String).includes(value))
            throw new Error(`Canon did not advertise the previous ${name}: ${value}`)
        await driver[setter](value)
        if (String(readSetting(driver, name)?.value) !== value)
            throw new Error(`Canon ${name} readback changed during the movie-mode transition`)
    }
}

/**
 * Holds still mode across one capture and its transfer, then puts the operator's movie mode and
 * manual exposure back. A body whose physical selector holds movie mode cannot take a photo: that
 * is reported as unsupported before any shutter command is sent.
 */
export async function withCanonPhotoMode<Result>(
    driver: CanonPhotoModeDriver,
    capture: () => Promise<Result>
): Promise<Result> {
    if (!inMovieMode(driver)) return capture()
    const before = snapshot(driver)
    let failure: unknown
    try {
        await driver.leaveMovieMode()
        await wait(MODE_SETTLE_MILLISECONDS)
        if (inMovieMode(driver))
            throw new CameraUnsupportedError(
                'takePhoto',
                'Set the Canon body’s physical still/movie selector to Photo; it retained movie mode after the remote Photo command'
            )
        return await capture()
    } catch (error) {
        failure = error
        throw error
    } finally {
        try {
            if (!inMovieMode(driver)) {
                await driver.enterMovieMode()
                await wait(MODE_SETTLE_MILLISECONDS)
                if (!inMovieMode(driver)) throw new Error('Canon did not restore movie mode')
            }
            await restoreExposure(driver, before)
        } catch (error) {
            if (failure)
                throw new AggregateError([failure, error], `${String(failure)}; restoring movie mode: ${String(error)}`)
            throw error
        }
    }
}
