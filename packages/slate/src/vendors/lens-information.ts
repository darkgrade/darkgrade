import type { CameraLens } from '@camera/controls'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { PTPResponseError } from '@core/ptp-errors'
import { FocalLength } from '@ptp/definitions/property-definitions'

/**
 * The lens from the standard PTP FocalLength property (0x5008), read only when the body advertises
 * it. ISO 15740 gives its value in hundredths of a millimetre (libgphoto2 divides by 100 as well).
 * Standard PTP has no lens name. A refused read leaves the lens unreported rather than failing the
 * whole capability read.
 */
export async function standardLens(
    camera: GenericCamera,
    advertisedProperties: readonly number[]
): Promise<CameraLens | undefined> {
    if (!advertisedProperties.includes(FocalLength.code)) return undefined
    let hundredths: number
    try {
        hundredths = await camera.get(FocalLength)
    } catch (error) {
        if (error instanceof PTPResponseError) return undefined
        throw error
    }
    if (!Number.isFinite(hundredths) || hundredths <= 0) return undefined
    return { name: null, focalLengthMillimetres: hundredths / 100 }
}
