import { CanonCamera } from '@camera/canon-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { cameraContext } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { withCanonPhotoMode } from '@vendors/canon/recording-mode'
import { withSonyPhotoMode } from '@vendors/sony/photo-mode'

export interface CaptureImageOptions {
    includeInfo?: boolean
    includeData?: boolean
    autofocus?: boolean
    destination?: 'card' | 'memory'
    rawCompression?: 'lossless'
}

export interface PhotoOperations {
    captureImage(params?: CaptureImageOptions): Promise<{ info?: ObjectInfo; data?: Uint8Array }>
}

export const photoOperations: PhotoOperations & ThisType<Camera> = {
    async captureImage(params?: CaptureImageOptions) {
        const { driver } = cameraContext(this)
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
        if (driver instanceof SonyCamera) return withSonyPhotoMode(this, capture)
        if (driver instanceof CanonCamera) return withCanonPhotoMode(this, capture)
        return capture()
    },
}
