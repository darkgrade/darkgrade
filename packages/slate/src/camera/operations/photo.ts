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
    /**
     * Sony: return the body to remote shooting after card access. Reading the card switches the
     * body's CameraOperatingMode (0xD0BC) to Playback, which is read-only over PTP and survives
     * leaving content-transfer mode; live view then serves the playback image. When the body still
     * reports Playback, this reopens the session (about 350 ms on an α7 V), which restores Record
     * mode. Returns true when it reopened, since object handles may change with the session.
     */
    resumeSonyShooting(): Promise<boolean>
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

    async resumeSonyShooting(): Promise<boolean> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera)) return false
        return driver.returnToShooting()
    },
}
