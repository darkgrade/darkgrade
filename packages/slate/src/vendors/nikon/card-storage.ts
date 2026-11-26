import type { StorageRecording } from '@vendors/generic/generic-camera'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'

/** PTP access describes host uploads; Nikon's camera-side card protection is separate. */
export async function nikonStorageCanRecord(driver: Pick<NikonCamera, 'registry' | 'get'>, accessCapability: number): Promise<StorageRecording> {
    if (accessCapability !== 0 && accessCapability !== 2) return { writable: false }
    const property = driver.registry.properties.MovieRecProhibitionCondition
    if (!property) return { writable: false }
    const condition = await driver.get(property)
    if (typeof condition !== 'string' || !condition) return { writable: false }
    return { writable: !/noCardInserted|cardAccessError|cardNotFormatted|noFreeSpace|cardProtected/.test(condition) }
}
