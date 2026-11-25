import { CanonCamera } from '@camera/canon-camera'
import type { ConfirmedPhotoFile, PhotoCapability } from '@camera/driver/photo'
import { CameraOutcomeUnknownError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { cameraContext, type CameraDriverInstance } from '@camera/operations/context'
import { strongestShutterOutcome } from '@camera/shutter-outcome'
import { SonyCamera } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { withCanonPhotoMode } from '@vendors/canon/photo-mode'
import { sonyPhotoModeDriver, withSonyPhotoMode } from '@vendors/sony/photo-mode'

type DriverCapture = { info?: ObjectInfo; data?: Uint8Array }

const SONY_CAMERA_OPERATING_MODE = 0xd0bc
const SONY_OPERATING_MODE_PLAYBACK = 2

/** The driver's answer for one release, checked: a file Slate cannot name is not a confirmed photo. */
function confirmedFile(capture: DriverCapture, wantsData: boolean): ConfirmedPhotoFile {
    const info = capture.info
    if (!info?.filename || !Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize <= 0)
        throw new CameraOutcomeUnknownError('takePhoto', 'The shutter was released, but the camera described no new photo file')
    if (wantsData && capture.data?.length !== info.objectCompressedSize)
        throw new CameraOutcomeUnknownError('takePhoto', 'The photo was taken, but its transfer did not match the size the camera reported')
    return {
        filename: info.filename,
        captureDate: info.captureDate,
        objectCompressedSize: info.objectCompressedSize,
        ...(wantsData && capture.data ? { data: capture.data } : {}),
    }
}

/** One outcome type per failure: restoration errors around an unconfirmed release stay unknown. */
async function classified(capture: () => Promise<ConfirmedPhotoFile>): Promise<ConfirmedPhotoFile> {
    try {
        return await capture()
    } catch (error) {
        throw strongestShutterOutcome(error)
    }
}

/**
 * Sony: still mode for a body in a movie mode, shooting mode after a card read, then one
 * two-stage release confirmed by the camera's object-added event. The photo is saved to the card
 * and sent to the computer (Sony's "both" destination), so the event names the new file; its
 * bytes are always read, which releases the camera's copy, and returned only for 'computer'.
 */
function sonyPhotoCapability(driver: SonyCamera, owner: Camera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async () => {
                await driver.resumeShooting()
                const states = await driver.refreshPropertyStates()
                if (states.find(state => state.code === SONY_CAMERA_OPERATING_MODE)?.rawValue === SONY_OPERATING_MODE_PLAYBACK)
                    await driver.reopenSession(cameraContext(owner).deviceDescriptor)
                const capture = await withSonyPhotoMode(sonyPhotoModeDriver(driver), () =>
                    driver.captureImage({ autofocus, includeInfo: true, includeData: true, destination: 'card' })
                )
                return confirmedFile(capture, destination === 'computer')
            }),
    }
}

/** Canon: still mode for a body in movie mode, then a release confirmed by the new file on the card. */
function canonPhotoCapability(driver: CanonCamera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async () => {
                const wantsData = destination === 'computer'
                const capture = await withCanonPhotoMode(driver, () =>
                    driver.captureImage({ autofocus, includeInfo: true, includeData: wantsData })
                )
                return confirmedFile(capture, wantsData)
            }),
    }
}

/**
 * Nikon: the photo is confirmed by the card's object-added event after the bounded readout
 * allowance, and for 'computer' read back from the card.
 */
function nikonPhotoCapability(driver: NikonCamera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async () => {
                const wantsData = destination === 'computer'
                const capture = await driver.captureImage({ autofocus, includeInfo: true, includeData: wantsData, destination: 'card' })
                return confirmedFile(capture, wantsData)
            }),
    }
}

/** Standard PTP: InitiateCapture confirmed by ObjectAdded. These bodies save to their card first. */
function standardPhotoCapability(driver: CameraDriverInstance): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async () => {
                if (!autofocus)
                    throw new CameraUnsupportedError(
                        'takePhoto',
                        'This camera has no documented release without autofocus over standard PTP; nothing was sent'
                    )
                const wantsData = destination === 'computer'
                const capture = await driver.captureImage({ includeInfo: true, includeData: wantsData })
                return confirmedFile(capture, wantsData)
            }),
    }
}

/** Each vendor's photo capability. Vendor branching lives here, never in the Camera façade. */
export function photoCapability(driver: CameraDriverInstance, owner: Camera): PhotoCapability | undefined {
    if (driver instanceof SonyCamera) return sonyPhotoCapability(driver, owner)
    if (driver instanceof CanonCamera) return canonPhotoCapability(driver)
    if (driver instanceof NikonCamera) return nikonPhotoCapability(driver)
    return standardPhotoCapability(driver)
}
