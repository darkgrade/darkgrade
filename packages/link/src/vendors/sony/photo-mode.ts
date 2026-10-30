import type { Camera } from '@camera/index'

/** Hold an advertised still mode across capture/transfer and restore the original movie mode. */
export async function withSonyPhotoMode<T>(camera: Camera, capture: () => Promise<T>): Promise<T> {
    const mode = (await camera.getSonyPropertyStates()).find(property => property.code === 0x500e)
    if (!mode || !/movie|s&q/i.test(String(mode.value))) return capture()
    const target = mode.allowedValues?.find(value => ['Manual', 'Program Auto', 'Still'].includes(String(value)))
    if (target === undefined) return capture()
    const property = camera.getInstance().registry.properties.ExposureProgramMode
    let failure: unknown
    try {
        await camera.set(property, target)
        await new Promise(resolve => setTimeout(resolve, 500))
        return await capture()
    } catch (error) {
        failure = error
        throw error
    } finally {
        try { await camera.set(property, mode.value) }
        catch (error) {
            if (failure) throw new AggregateError([failure, error], `${String(failure)}; restoring Sony movie mode: ${String(error)}`)
            throw error
        }
    }
}
