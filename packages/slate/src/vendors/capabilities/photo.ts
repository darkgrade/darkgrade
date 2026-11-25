import { CanonCamera } from '@camera/canon-camera'
import type { ConfirmedPhotoFile, PhotoCapability } from '@camera/driver/photo'
import { CameraOutcomeUnknownError, CameraUnsupportedError } from '@camera/errors'
import { NikonCamera } from '@camera/nikon-camera'
import type { CameraDriverInstance } from '@camera/operations/context'
import { afterShutterRelease, photoOutcome } from '@camera/shutter-outcome'
import { SonyCamera } from '@camera/sony-camera'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { withCanonPhotoMode } from '@vendors/canon/photo-mode'
import { encodeMediaId, type MediaReference } from '@vendors/media/media-id'
import { findSonyCardFile, markSonyCardIndex, type SonyCardIndexMark } from '@vendors/media/sony-media'
import { sonyPhotoModeDriver, withSonyPhotoMode } from '@vendors/sony/photo-mode'

type DriverCapture = { info?: ObjectInfo; data?: Uint8Array; objectHandle?: number }

/** How long Sony's card index may take to list a photo its camera already announced. */
const SONY_CARD_INDEX_TIMEOUT_MS = 10_000
const SONY_CARD_INDEX_POLL_MS = 250

/** The driver's answer for one release, checked: a file Slate cannot name is not a confirmed photo. */
function describedFile(capture: DriverCapture, wantsData: boolean): { info: ObjectInfo; data?: Uint8Array } {
    const info = capture.info
    if (!info?.filename || !Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize <= 0)
        throw new CameraOutcomeUnknownError('takePhoto', 'The shutter was released, but the camera described no new photo file')
    if (wantsData && capture.data?.length !== info.objectCompressedSize)
        throw new CameraOutcomeUnknownError('takePhoto', 'The photo was taken, but its transfer did not match the size the camera reported')
    return { info, ...(wantsData && capture.data ? { data: capture.data } : {}) }
}

/** A card object found through standard PTP handles, named with the id `listMedia()` gives it. */
function cardObjectFile(capture: DriverCapture, wantsData: boolean): ConfirmedPhotoFile {
    const { info, data } = describedFile(capture, wantsData)
    if (capture.objectHandle === undefined)
        throw new CameraOutcomeUnknownError('takePhoto', `The photo ${info.filename} was taken, but the camera did not name its card object`)
    const sizeBytes = info.objectCompressedSize
    const reference: MediaReference = { source: 'object', storageId: info.storageID, objectHandle: capture.objectHandle, name: info.filename, sizeBytes }
    return { mediaId: encodeMediaId(reference), name: info.filename, sizeBytes, ...(data && { data }) }
}

/**
 * Runs one capture and reports a failure as one of the three outcomes. `confirmed` is called once
 * the driver has confirmed the photo, so a mode restoration that fails after it is never a refusal.
 */
async function classified(capture: (confirmed: () => void) => Promise<ConfirmedPhotoFile>): Promise<ConfirmedPhotoFile> {
    let photoConfirmed = false
    try {
        return await capture(() => (photoConfirmed = true))
    } catch (error) {
        throw photoOutcome(error, photoConfirmed)
    }
}

/** Where Sony's card index ends before the release, or undefined when the body offers none. */
async function markCardIndex(driver: SonyCamera): Promise<SonyCardIndexMark | undefined> {
    try {
        return await markSonyCardIndex(driver, 'takePhoto')
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return undefined
        throw error
    }
}

/**
 * The card file Sony's camera announced for the computer (its 0xFFFFC001 host object), found in
 * the camera's own card index among the files added since `mark`, so its id and size are the ones
 * `listMedia()` gives it.
 */
async function sonyCardFile(driver: SonyCamera, name: string, mark: SonyCardIndexMark): Promise<{ mediaId: string; sizeBytes?: number }> {
    const deadline = Date.now() + SONY_CARD_INDEX_TIMEOUT_MS
    for (;;) {
        const item = await findSonyCardFile(driver, 'takePhoto', name, mark)
        if (item) return { mediaId: item.id, ...(item.sizeBytes !== undefined && { sizeBytes: item.sizeBytes }) }
        if (Date.now() >= deadline)
            throw new Error(`The camera announced ${name}, but its card index did not list it within ${SONY_CARD_INDEX_TIMEOUT_MS / 1000} seconds`)
        await new Promise(resolve => setTimeout(resolve, SONY_CARD_INDEX_POLL_MS))
    }
}

/**
 * Sony: still mode for a body in a movie mode, shooting mode after a card read, then one
 * two-stage release confirmed by the camera's object-added event. The photo is saved to the card
 * and sent to the computer (Sony's "both" destination), so the event names the new file; its
 * bytes are always read, which releases the camera's copy, and returned only for 'computer'. The
 * file's id and size come from the camera's card index, as `listMedia()` reports them; a body
 * that offers no card index has no media ids, so its photo has none.
 */
function sonyPhotoCapability(driver: SonyCamera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async confirmed => {
                await driver.returnToShooting()
                const mark = await markCardIndex(driver)
                const capture = await withSonyPhotoMode(sonyPhotoModeDriver(driver), async () => {
                    const captured = await driver.captureImage({ autofocus, includeInfo: true, includeData: true, destination: 'card' })
                    confirmed()
                    return captured
                })
                const { info, data } = describedFile(capture, destination === 'computer')
                const card: { mediaId?: string; sizeBytes?: number } = mark ? await afterShutterRelease(() => sonyCardFile(driver, info.filename, mark)) : {}
                return { ...card, name: info.filename, sizeBytes: card.sizeBytes ?? info.objectCompressedSize, ...(data && { data }) }
            }),
    }
}

/** Canon: still mode for a body in movie mode, then a release confirmed by the new file on the card. */
function canonPhotoCapability(driver: CanonCamera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async confirmed => {
                const wantsData = destination === 'computer'
                const capture = await withCanonPhotoMode(driver, async () => {
                    const captured = await driver.captureImage({ autofocus, includeInfo: true, includeData: wantsData })
                    confirmed()
                    return captured
                })
                return cardObjectFile(capture, wantsData)
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
            classified(async confirmed => {
                const wantsData = destination === 'computer'
                const capture = await driver.captureImage({ autofocus, includeInfo: true, includeData: wantsData, destination: 'card' })
                confirmed()
                return cardObjectFile(capture, wantsData)
            }),
    }
}

/** Standard PTP: InitiateCapture confirmed by ObjectAdded. These bodies save to their card first. */
function standardPhotoCapability(driver: CameraDriverInstance): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async confirmed => {
                if (!autofocus)
                    throw new CameraUnsupportedError(
                        'takePhoto',
                        'This camera has no documented release without autofocus over standard PTP; nothing was sent'
                    )
                const wantsData = destination === 'computer'
                const capture = await driver.captureImage({ includeInfo: true, includeData: wantsData })
                confirmed()
                return cardObjectFile(capture, wantsData)
            }),
    }
}

/** Each vendor's photo capability. Vendor branching lives here, never in the Camera façade. */
export function photoCapability(driver: CameraDriverInstance): PhotoCapability | undefined {
    if (driver instanceof SonyCamera) return sonyPhotoCapability(driver)
    if (driver instanceof CanonCamera) return canonPhotoCapability(driver)
    if (driver instanceof NikonCamera) return nikonPhotoCapability(driver)
    return standardPhotoCapability(driver)
}
