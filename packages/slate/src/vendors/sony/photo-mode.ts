import { protocolAccess } from '@camera/protocol-session'
import type { Camera } from '@camera/index'
import type { SonyCamera, SonyPropertyState } from '@vendors/sony/sony-camera'
import { isSonyMovieExposureProgram, sonyCounterpartExposureProgram } from '@vendors/sony/exposure-program'
import { readSonyMovieCard } from '@vendors/sony/card-storage'
import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'

/** Explicit recording preparation selects only the camera-advertised corresponding movie mode. */
export async function openSonyRecordingMode(camera: Camera) {
    if (await camera.getRecordingState() !== 'idle') throw new Error('Stop Sony recording before preparing movie mode')
    const before = (await camera.getCapabilities()).controls.exposureProgram
    const original = before?.value
    // The same counterpart photoVideoMode selects (`@vendors/sony/exposure-program`).
    const target = isSonyMovieExposureProgram(original) ? original : sonyCounterpartExposureProgram(original)
    if (target === undefined || !isSonyMovieExposureProgram(original) &&
        (!before?.writable || !before.allowedValues?.includes(target)))
        throw new Error('Select Movie mode on the Sony camera; no corresponding writable movie mode was advertised')
    let changed = false
    const selectMode = async (requested: string) => {
        const before = (await camera.getCapabilities()).controls.exposureProgram?.value
        try { await camera.setControl('exposureProgram', requested) }
        catch (error) {
            protocolAccess(camera).driver.recordStateSnapshot('recording', 'failure')
            // Sony's shipped sample reconciles acknowledged, unapplied mode selections.
            // Generic writes stay single-attempt; only an unchanged, writable, idle mode
            // admits one extra idempotent selection. I/O errors and unknown outcomes stop.
            if (!(error instanceof CameraConfirmationError) || error.operation !== 'exposureProgram' ||
                error.expected !== requested || error.observed !== before ||
                await camera.getRecordingState() !== 'idle') throw error
            const observed = (await camera.getCapabilities()).controls.exposureProgram
            if (observed?.value !== before || !observed.enabled || !observed.writable ||
                !observed.allowedValues?.includes(requested)) throw error
            try { await camera.setControl('exposureProgram', requested) }
            catch (second) {
                if (second instanceof Error && second.cause === undefined) second.cause = error
                throw second
            }
        }
    }
    const restore = async () => {
        if (!changed) return
        if (await camera.getRecordingState() !== 'idle')
            throw new Error('Sony recording is not confirmed stopped; preserve its movie mode')
        if ((await camera.getCapabilities()).controls.exposureProgram?.value === original) {
            changed = false
            return
        }
        // The a6700 reports idle before file finalization makes the mode writable.
        // Poll admission only; never retry a mode write after an uncertain response.
        await confirmCameraValue('exposureProgram', 'writable after recording', async () => {
            if (await camera.getRecordingState() !== 'idle')
                throw new Error('Sony recording is not confirmed stopped; preserve its movie mode')
            const mode = (await camera.getCapabilities()).controls.exposureProgram
            return mode?.enabled && mode.writable && mode.allowedValues?.includes(original as string)
                ? 'writable after recording' : null
        }, 5000)
        await selectMode(original as string)
        changed = false
    }
    try {
        if (target !== original) {
            // Retain restoration even when the write reaches the body but its readback fails.
            changed = true
            await selectMode(target as string)
        }
        const card = await readSonyMovieCard(camera)
        if (card.remainingMovieSeconds === 0) throw new Error('No movie recording time remains on the selected Sony memory card')
        return { restore }
    } catch (error) {
        try { await restore() }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'Sony recording preparation and restoration failed') }
        throw error
    }
}

/** What still-mode preparation needs from a Sony session: fresh property states and one mode write. */
export interface SonyPhotoModeDriver {
    refreshPropertyStates(): Promise<Pick<SonyPropertyState, 'code' | 'value' | 'allowedValues'>[]>
    setExposureProgram(value: string): Promise<void>
}

/** The Sony driver as a photo-mode session. */
export function sonyPhotoModeDriver(driver: SonyCamera): SonyPhotoModeDriver {
    return {
        refreshPropertyStates: () => driver.refreshPropertyStates(),
        setExposureProgram: value => driver.set(driver.registry.properties.ExposureProgramMode, value),
    }
}

const SONY_EXPOSURE_PROGRAM_MODE = 0x500e
const SONY_STILL_MODES = ['Manual', 'Program Auto', 'Program', 'Still']

/** Hold an advertised still mode across capture/transfer and restore the original movie mode. */
export async function withSonyPhotoMode<T>(driver: SonyPhotoModeDriver, capture: () => Promise<T>): Promise<T> {
    const mode = (await driver.refreshPropertyStates()).find(property => property.code === SONY_EXPOSURE_PROGRAM_MODE)
    if (!mode || !/movie|s&q/i.test(String(mode.value))) return capture()
    const target = mode.allowedValues?.find(value => SONY_STILL_MODES.includes(String(value)))
    if (target === undefined) return capture()
    let failure: unknown
    try {
        await driver.setExposureProgram(String(target))
        await new Promise(resolve => setTimeout(resolve, 500))
        return await capture()
    } catch (error) {
        failure = error
        throw error
    } finally {
        try { await driver.setExposureProgram(String(mode.value)) }
        catch (error) {
            if (failure) throw new AggregateError([failure, error], `${String(failure)}; restoring Sony movie mode: ${String(error)}`)
            throw error
        }
    }
}
