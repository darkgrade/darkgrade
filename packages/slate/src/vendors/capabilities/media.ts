import type { MediaCapability } from '@camera/driver/media'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { ptpMediaCapability } from '@vendors/media/ptp-media'
import { sonyMediaCapability } from '@vendors/media/sony-media'

/**
 * Each vendor's card media. Sony reads its own card index and property snapshot; every other
 * driver (Canon, Nikon, generic PTP and the vendor extensions) uses standard object handles and
 * StorageInfo, with the driver's own transfer.
 */
export function mediaCapability(driver: CameraDriverInstance, owner: Camera): MediaCapability {
    if (driver instanceof SonyCamera) return sonyMediaCapability(driver)
    return ptpMediaCapability(driver, owner)
}
