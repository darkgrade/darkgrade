import type { Camera } from '@camera/index'
import { isSonyMovieExposureProgram } from '@vendors/sony/exposure-program'
import { readSonyMovieCard } from '@vendors/sony/card-storage'

/** Explicit recording preparation selects only the camera-advertised corresponding movie mode. */
export async function openSonyRecordingMode(camera: Camera) {
    if (await camera.getRecordingState() !== 'idle') throw new Error('Stop Sony recording before preparing movie mode')
    const before = (await camera.getCapabilities()).controls.exposureProgram
    const original = before?.value
    const target = isSonyMovieExposureProgram(original) ? original : `Movie ${original}`
    if (!isSonyMovieExposureProgram(original) &&
        (!before?.writable || !before.allowedValues?.includes(target as string)))
        throw new Error('Select Movie mode on the Sony camera; no corresponding writable movie mode was advertised')
    let changed = false
    const restore = async () => {
        if (!changed) return
        if (await camera.getRecordingState() !== 'idle')
            throw new Error('Sony recording is not confirmed stopped; preserve its movie mode')
        await camera.setControl('exposureProgram', original as string)
        changed = false
    }
    try {
        if (target !== original) {
            // Retain restoration even when the write reaches the body but its readback fails.
            changed = true
            await camera.setControl('exposureProgram', target as string)
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

/** Hold an advertised still mode across capture/transfer and restore the original movie mode. */
export async function withSonyPhotoMode<T>(camera: Camera, capture: () => Promise<T>): Promise<T> {
    const mode = (await camera.getSonyPropertyStates()).find(property => property.code === 0x500e)
    if (!mode || !/movie|s&q/i.test(String(mode.value))) return capture()
    const target = mode.allowedValues?.find(value => ['Manual', 'Program Auto', 'Still'].includes(String(value)))
    if (target === undefined) return capture()
    const property = camera.getInstance().registry.properties.ExposureProgramMode
    let failure: unknown
    try {
        await camera.set(property, String(target))
        await new Promise(resolve => setTimeout(resolve, 500))
        return await capture()
    } catch (error) {
        failure = error
        throw error
    } finally {
        try { await camera.set(property, String(mode.value)) }
        catch (error) {
            if (failure) throw new AggregateError([failure, error], `${String(failure)}; restoring Sony movie mode: ${String(error)}`)
            throw error
        }
    }
}
