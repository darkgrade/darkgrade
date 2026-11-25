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
     * camera that cannot take one now is CameraUnsupportedError. It is refused while the camera
     * reports a recording, so Stop never waits behind a photo's confirmation.
     */
    takePhoto(options?: TakePhotoOptions & { destination?: 'card' }): Promise<CardPhoto>
    takePhoto(options: TakePhotoOptions & { destination: 'computer' }): Promise<ComputerPhoto>
    takePhoto(options?: TakePhotoOptions): Promise<Photo>
    captureImage(params?: CaptureImageOptions): Promise<{ info?: ObjectInfo; data?: Uint8Array }>
}

function photoFrom(file: ConfirmedPhotoFile, destination: 'card' | 'computer'): Photo {
    const described = { ...(file.mediaId !== undefined && { mediaId: file.mediaId }), name: file.name, sizeBytes: file.sizeBytes }
    if (destination === 'card') return { destination, ...described }
    if (!file.data) throw new CameraOutcomeUnknownError('takePhoto', 'The photo was taken, but its bytes did not reach the computer')
    return { destination, ...described, data: file.data }
}

/**
 * A photo holds the camera's operation queue until its file is confirmed, which on Nikon can take
 * well over a minute after a long exposure. startRecording waits on the same queue, so refusing a
 * photo while a recording is observed means Stop never waits behind one. An unreadable or unknown
 * recording state is not a recording: generic bodies report none.
 */
async function refuseWhileRecording(camera: Camera): Promise<void> {
    const state = await camera.getRecordingState().catch(() => 'unknown' as const)
    if (state === 'recording' || state === 'starting' || state === 'stopping')
        throw new CameraRefusedError('takePhoto', `The camera is ${state === 'recording' ? 'recording' : `${state} a recording`}; stop it before taking a photo`)
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
    const file = await cameraContext(this).controlsQueue.run('camera', async () => {
        await refuseWhileRecording(this)
        return photo.takePhoto({ autofocus, destination })
    })
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
}
