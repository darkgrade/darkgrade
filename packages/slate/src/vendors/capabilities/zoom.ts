import type { ZoomCapability } from '@camera/driver/zoom'
import type { Camera } from '@camera/index'
import type { CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import { SonyPowerZoom } from '@vendors/sony/power-zoom'

/**
 * Each vendor's zoom capability, or undefined when the driver cannot drive a zoom. Only Sony has
 * a remote zoom command over USB; Canon, Nikon and standard PTP bodies report zoom unsupported.
 */
export function zoomCapability(driver: CameraDriverInstance, _owner: Camera): ZoomCapability | undefined {
    if (driver instanceof SonyCamera) return new SonyPowerZoom(driver)
    return undefined
}
