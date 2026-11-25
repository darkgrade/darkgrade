import type { CameraRecordingState } from '@camera/controls'
import type { Clip, FocusDirection, FocusFrame, FocusPointOptions, FocusStepSize } from '@camera/driver'
import { CameraOutcomeUnknownError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { FocusCapability, LiveViewCapability, PhotoCapability } from '@vendors/generic/capability-groups'
import {
    cardObjectFile,
    cardSteps,
    classified,
    clipFinalizationMilliseconds,
    clipFrom,
    operationsAdvertised,
    overlayUnsupported,
    requireImage,
    requireNudge,
    requirePoint,
    storageHost,
} from '@vendors/generic/generic-operations'
import { type VendorRecording } from '@vendors/generic/recording-lifecycle'
import { waitForNewCameraMovie } from '@vendors/generic/storage'
import { NikonCamera, type NikonLiveViewMetadata } from '@vendors/nikon/nikon-camera'
import { readNikonObjectSize } from '@vendors/nikon/object-size'
import { readNikonRecordingStatus } from '@vendors/nikon/recording-status'

/*
 * TRANSITIONAL (consolidation setup). Nikon's operation code, moved verbatim from the per-area
 * capability modules. NikonCamera's driver-contract methods call these; fold each into the driver's
 * own method and delete it here.
 */

/** How often Nikon's event queue is read while someone is listening. */
export const NIKON_EVENT_POLL_INTERVAL_MILLISECONDS = 500

/**
 * Nikon queues events until GetEventEx reads them, and opening a camera starts no background poll.
 * The pump runs only while at least one listener exists, so a camera nobody listens to keeps its
 * queue for the operations that read it; a memory capture keeps its own announcements either way.
 */
export function nikonEventPump(driver: NikonCamera) {
    let listeners = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
        timer = setTimeout(async () => {
            timer = undefined
            if (listeners === 0) return
            if (driver.sessionId !== null) await driver.pollEvents().catch(() => undefined)
            if (listeners > 0) schedule()
        }, NIKON_EVENT_POLL_INTERVAL_MILLISECONDS)
    }
    return {
        attach(): () => void {
            listeners++
            if (listeners === 1 && !timer) schedule()
            let attached = true
            return () => {
                if (!attached) return
                attached = false
                listeners--
                if (listeners === 0 && timer) {
                    clearTimeout(timer)
                    timer = undefined
                }
            }
        },
    }
}

/**
 * Nikon: the photo is confirmed by the card's object-added event after the bounded readout
 * allowance, and for 'computer' read back from the card.
 */
export function nikonPhotoCapability(driver: NikonCamera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async confirmed => {
                const wantsData = destination === 'computer'
                const capture = await driver.captureImage({
                    autofocus,
                    includeInfo: true,
                    includeData: wantsData,
                    destination: 'card',
                })
                confirmed()
                return cardObjectFile(capture, wantsData)
            }),
    }
}

/**
 * MfDrive steps per nudge. Nikon's USB reference takes 1–32767 lens drive steps without a unit;
 * these follow the small/medium/large steps of tethering apps and are not yet bench-calibrated.
 */
export const NIKON_FOCUS_STEPS: Record<FocusStepSize, number> = { small: 10, medium: 100, large: 500 }

export function nikonFocusCapability(driver: NikonCamera): FocusCapability {
    const operations = driver.registry.operations
    const liveView = [operations.DeviceReady, operations.StartLiveView, operations.GetLiveViewImageEx]
    return {
        availability(capabilities) {
            const point = operationsAdvertised(capabilities, [operations.ChangeAfArea, ...liveView])
            return {
                autofocus: operationsAdvertised(capabilities, [
                    operations.AfDrive,
                    operations.AfDriveCancel,
                    ...liveView,
                ]),
                setFocusPoint: point,
                resetFocusPoint: point,
                nudgeFocus: operationsAdvertised(capabilities, [operations.MfDrive, ...liveView]),
            }
        },

        async autofocus() {
            return (await driver.performAutofocus()).focusAcquired ? 'acquired' : 'not-acquired'
        },

        async setFocusPoint(x: number, y: number, options: FocusPointOptions) {
            requirePoint(x, y)
            const placed = await driver.touchFocus(x, y, { focus: options.autofocus })
            if (!placed.positionVerified)
                throw new CameraOutcomeUnknownError(
                    'setFocusPoint',
                    `The Nikon accepted the focus point but its live view reports the AF frame elsewhere (${placed.metadata.afFrameCenterCoords?.horizontal}, ${placed.metadata.afFrameCenterCoords?.vertical})`
                )
        },

        async resetFocusPoint() {
            await driver.touchFocus(0.5, 0.5, { focus: false })
        },

        async nudgeFocus(direction: FocusDirection, size: FocusStepSize) {
            requireNudge(direction, size)
            await driver.driveFocus(direction, NIKON_FOCUS_STEPS[size])
        },

        settingWritten() {},
    }
}

/** Nikon's AF frame, normalized over the displayed area so it lines up with the picture when magnified. */
export function nikonFocusFrames(metadata: NikonLiveViewMetadata | undefined): FocusFrame[] {
    if (!metadata) return []
    const { afFrameCenterCoords: center, afFrameSize: size, displayAreaSize, displayCenterCoords, wholeSize } = metadata
    const display =
        displayAreaSize?.horizontal > 0 && displayAreaSize.vertical > 0 && displayCenterCoords
            ? {
                  left: displayCenterCoords.horizontal - displayAreaSize.horizontal / 2,
                  top: displayCenterCoords.vertical - displayAreaSize.vertical / 2,
                  width: displayAreaSize.horizontal,
                  height: displayAreaSize.vertical,
              }
            : wholeSize?.horizontal > 0 && wholeSize.vertical > 0
              ? { left: 0, top: 0, width: wholeSize.horizontal, height: wholeSize.vertical }
              : undefined
    if (!display || !center || !size || size.horizontal <= 0 || size.vertical <= 0) return []
    return [
        {
            kind: 'focus',
            // Nikon focusing judgement: 0 no information, 1 not focused, 2 focused.
            focused: metadata.focusingJudgementResult === 2,
            centerX: (center.horizontal - display.left) / display.width,
            centerY: (center.vertical - display.top) / display.height,
            width: size.horizontal / display.width,
            height: size.vertical / display.height,
        },
    ]
}

export function nikonLiveView(driver: NikonCamera): LiveViewCapability {
    return {
        availability: () => ({
            getLiveViewFrame: {
                supported: true,
                options: { overlay: { supported: false, reason: overlayUnsupported } },
            },
        }),
        async getLiveViewFrame({ overlay }) {
            if (overlay) throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
            const frame = await driver.captureLiveView({ includeInfo: false })
            return { jpeg: requireImage(frame.data), focusFrames: nikonFocusFrames(frame.nikonMetadata) }
        },
    }
}

/**
 * Nikon's own Record prepares video mode, live view and application mode, checks the card through
 * its prohibition flags, and its Stop restores them once the movie is no longer recording.
 */
export function nikonRecording(driver: NikonCamera, owner: Camera): VendorRecording {
    const host = storageHost(driver)
    const card = cardSteps(driver, owner)
    return {
        ...card,
        async readState(): Promise<CameraRecordingState> {
            const status = await readNikonRecordingStatus(host)
            return !status ? 'unknown' : status.recording ? 'recording' : status.bufferedImages ? 'stopping' : 'idle'
        },
        async findClip(baseline: Set<number>): Promise<Clip> {
            const movie = await waitForNewCameraMovie(host, baseline, clipFinalizationMilliseconds)
            const reported = Number(movie.objectCompressedSize)
            return clipFrom(movie.handle, movie.filename, await readNikonObjectSize(host, movie.handle, reported))
        },
        sendStart: () => driver.sendStartRecording(),
        sendStop: () => driver.sendStopRecording(),
    }
}
