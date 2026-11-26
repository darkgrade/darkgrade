import { cameraContext } from '@camera/camera-context'
import type { Camera } from '@camera/index'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CanonCamera } from '@vendors/canon/canon-camera'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { sonyPhotoModeDriver, withSonyPhotoMode } from '@vendors/sony/photo-mode'
import { SonyCamera } from '@vendors/sony/sony-camera'

export type { CardPhoto, ComputerPhoto, Photo, PhotoDestination, TakePhotoOptions } from '@camera/driver'

export interface CaptureImageOptions {
    includeInfo?: boolean
    includeData?: boolean
    autofocus?: boolean
    destination?: 'card' | 'memory'
    rawCompression?: 'lossless'
}

/**
 * The driver's own release with the vendor's still-mode preparation, for Slate's workflows that need
 * its raw ObjectInfo or a host-memory transfer (the benchmark profile). Not a Camera method:
 * applications use takePhoto, which confirms the new file.
 */
export async function captureDriverImage(
    camera: Camera,
    params?: CaptureImageOptions
): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
    const { driver } = cameraContext(camera)
    if (params?.rawCompression !== undefined && driver.vendorId !== VendorIDs.NIKON)
        throw new Error('RAW compression selection requires a Nikon camera')
    if (params?.destination === 'memory' && !(driver instanceof NikonCamera) && !(driver instanceof SonyCamera))
        throw new Error('Capture to memory is only implemented for Nikon and Sony cameras')
    if (
        params?.autofocus === false &&
        !(driver instanceof CanonCamera) &&
        !(driver instanceof NikonCamera) &&
        !(driver instanceof SonyCamera)
    )
        throw new Error('Capture without autofocus is only implemented for Canon EOS, Nikon and Sony cameras')
    const capture = () => driver.captureImage({ includeInfo: true, includeData: true, ...params })
    if (driver instanceof SonyCamera) return withSonyPhotoMode(sonyPhotoModeDriver(driver), capture)
    if (driver instanceof CanonCamera) return driver.withPhotoMode(capture)
    return capture()
}
