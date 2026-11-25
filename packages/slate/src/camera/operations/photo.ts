import { CanonCamera } from '@camera/canon-camera'
import type { CardPhoto, ComputerPhoto, ConfirmedPhotoFile, Photo, TakePhotoOptions } from '@camera/driver/photo'
import { CameraOutcomeUnknownError, CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { cameraContext, requireCapability } from '@camera/operations/context'
import { SonyCamera } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { withCanonPhotoMode } from '@vendors/canon/photo-mode'
import { sonyPhotoModeDriver, withSonyPhotoMode } from '@vendors/sony/photo-mode'

const SONY_CAMERA_OPERATING_MODE = 0xd0bc
const SONY_OPERATING_MODE_PLAYBACK = 2

export type { CardPhoto, ComputerPhoto, Photo, PhotoDestination, TakePhotoOptions } from '@camera/driver/photo'

export interface CaptureImageOptions {
    includeInfo?: boolean
    includeData?: boolean
    autofocus?: boolean
    destination?: 'card' | 'memory'
    rawCompression?: 'lossless'
}

export interface PhotoOperations {
    /**
     * Takes one photo and resolves only once the camera shows the new file: its media id, name and
     * size, and for `destination: 'computer'` its bytes. Photo or video mode preparation happens
     * inside and is undone afterwards. The shutter command is never resent: an unconfirmed release
     * is CameraOutcomeUnknownError, a release the camera refuses is CameraRefusedError, and a
     * camera that cannot take one now is CameraUnsupportedError.
     */
    takePhoto(options?: TakePhotoOptions & { destination?: 'card' }): Promise<CardPhoto>
    takePhoto(options: TakePhotoOptions & { destination: 'computer' }): Promise<ComputerPhoto>
    takePhoto(options?: TakePhotoOptions): Promise<Photo>
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

const mediaId = (file: ConfirmedPhotoFile) => (file.captureDate ? `${file.captureDate}/${file.filename}` : file.filename)

function photoFrom(file: ConfirmedPhotoFile, destination: 'card' | 'computer'): Photo {
    const described = { mediaId: mediaId(file), name: file.filename, sizeBytes: file.objectCompressedSize }
    if (destination === 'card') return { destination, ...described }
    if (!file.data) throw new CameraOutcomeUnknownError('takePhoto', 'The photo was taken, but its bytes did not reach the computer')
    return { destination, ...described, data: file.data }
}

function takePhoto(this: Camera, options?: TakePhotoOptions & { destination?: 'card' }): Promise<CardPhoto>
function takePhoto(this: Camera, options: TakePhotoOptions & { destination: 'computer' }): Promise<ComputerPhoto>
function takePhoto(this: Camera, options?: TakePhotoOptions): Promise<Photo>
async function takePhoto(this: Camera, options: TakePhotoOptions = {}): Promise<Photo> {
    const autofocus = options.autofocus ?? true
    const destination = options.destination ?? 'card'
    if (typeof autofocus !== 'boolean') throw new CameraRefusedError('takePhoto', 'autofocus must be true or false')
    if (destination !== 'card' && destination !== 'computer')
        throw new CameraRefusedError('takePhoto', "destination must be 'card' or 'computer'")
    const photo = requireCapability(this, 'photo', 'takePhoto')
    const file = await cameraContext(this).controlsQueue.run('camera', () => photo.takePhoto({ autofocus, destination }))
    return photoFrom(file, destination)
}

export const photoOperations: PhotoOperations & ThisType<Camera> = {
    takePhoto,

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
        if (driver instanceof SonyCamera) return withSonyPhotoMode(sonyPhotoModeDriver(driver), capture)
        if (driver instanceof CanonCamera) return withCanonPhotoMode(driver, capture)
        return capture()
    },

    async resumeSonyShooting(): Promise<boolean> {
        const context = cameraContext(this)
        const { driver } = context
        if (!(driver instanceof SonyCamera)) return false
        await driver.resumeShooting()
        const states = await driver.refreshPropertyStates()
        const operatingMode = states.find(state => state.code === SONY_CAMERA_OPERATING_MODE)
        if (operatingMode?.rawValue !== SONY_OPERATING_MODE_PLAYBACK) return false
        await driver.reopenSession(context.deviceDescriptor)
        return true
    },
}
