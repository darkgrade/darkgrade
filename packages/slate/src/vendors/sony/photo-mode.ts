import { protocolAccess } from '@camera/protocol-session'
import type { Camera } from '@camera/index'
import type { SonyCamera, SonyPropertyState } from '@vendors/sony/sony-camera'
import { sonyCounterpartExposureProgram, sonyExposureProgramKind } from '@vendors/sony/exposure-program'
import { readSonyMovieCard } from '@vendors/sony/card-storage'
import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'

/**
 * Explicit recording preparation: photoVideoMode selects the camera-advertised movie counterpart of
 * the current program (`@vendors/sony/exposure-program`), the one photo/movie switch Slate has.
 */
export async function openSonyRecordingMode(camera: Camera) {
    if (await camera.getRecordingState() !== 'idle') throw new Error('Stop Sony recording before preparing movie mode')
    const before = (await camera.getCapabilities()).controls.photoVideoMode
    const original = before?.value
    if (original !== 'video' && (!before?.writable || !before.allowedValues?.includes('video')))
        throw new Error('Select Movie mode on the Sony camera; no corresponding writable movie mode was advertised')
    let changed = false
    const selectMode = async (requested: 'photo' | 'video') => {
        const before = (await camera.getCapabilities()).controls.photoVideoMode?.value
        try { await camera.setControl('photoVideoMode', requested) }
        catch (error) {
            protocolAccess(camera).driver.recordStateSnapshot('recording', 'failure')
            // Sony's shipped sample reconciles acknowledged, unapplied mode selections.
            // Generic writes stay single-attempt; only an unchanged, writable, idle mode
            // admits one extra idempotent selection. I/O errors and unknown outcomes stop.
            if (!(error instanceof CameraConfirmationError) || error.operation !== 'photoVideoMode' ||
                error.expected !== requested || error.observed !== before ||
                await camera.getRecordingState() !== 'idle') throw error
            const observed = (await camera.getCapabilities()).controls.photoVideoMode
            if (observed?.value !== before || !observed.enabled || !observed.writable ||
                !observed.allowedValues?.includes(requested)) throw error
            try { await camera.setControl('photoVideoMode', requested) }
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
        if ((await camera.getCapabilities()).controls.photoVideoMode?.value === 'photo') {
            changed = false
            return
        }
        // The a6700 reports idle before file finalization makes the mode writable.
        // Poll admission only; never retry a mode write after an uncertain response.
        await confirmCameraValue('photoVideoMode', 'writable after recording', async () => {
            if (await camera.getRecordingState() !== 'idle')
                throw new Error('Sony recording is not confirmed stopped; preserve its movie mode')
            const mode = (await camera.getCapabilities()).controls.photoVideoMode
            return mode?.enabled && mode.writable && mode.allowedValues?.includes('photo')
                ? 'writable after recording' : null
        }, 5000)
        await selectMode('photo')
        changed = false
    }
    try {
        if (original !== 'video') {
            // Retain restoration even when the write reaches the body but its readback fails.
            changed = true
            await selectMode('video')
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

/** How long the body may take to show the still mode it was set to, and how often it is read meanwhile. */
const STILL_MODE_READBACK_MILLISECONDS = 2000
const STILL_MODE_POLL_MILLISECONDS = 100

/** Waits until the body's exposure program reads `target` (in place of a fixed half second). */
async function stillModeShown(driver: SonyPhotoModeDriver, target: unknown): Promise<void> {
    const deadline = Date.now() + STILL_MODE_READBACK_MILLISECONDS
    do {
        const mode = (await driver.refreshPropertyStates()).find(property => property.code === SONY_EXPOSURE_PROGRAM_MODE)
        if (mode?.value === target) return
        await new Promise(resolve => setTimeout(resolve, STILL_MODE_POLL_MILLISECONDS))
    } while (Date.now() < deadline)
    throw new Error(`Sony did not show ${String(target)} after it was selected for the photo`)
}

/** Hold an advertised still mode across capture/transfer and restore the original movie mode. */
export async function withSonyPhotoMode<T>(driver: SonyPhotoModeDriver, capture: () => Promise<T>): Promise<T> {
    const mode = (await driver.refreshPropertyStates()).find(property => property.code === SONY_EXPOSURE_PROGRAM_MODE)
    if (!mode || sonyExposureProgramKind(mode.value) !== 'video') return capture()
    // The program's photo counterpart (as photoVideoMode selects it), else an advertised still mode.
    const counterpart = sonyCounterpartExposureProgram(mode.value)
    const target = mode.allowedValues?.find(value => value === counterpart) ??
        mode.allowedValues?.find(value => SONY_STILL_MODES.includes(String(value)))
    if (target === undefined) return capture()
    let failure: unknown
    try {
        await driver.setExposureProgram(String(target))
        await stillModeShown(driver, target)
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
