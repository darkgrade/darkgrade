import type { CameraRecordingState } from '@camera/controls'
import type {
    CameraEventHandler,
    CameraEventName,
    FocusDirection,
    FocusPointOptions,
    FocusStepSize,
} from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { PTPResponseError } from '@core/ptp-errors'
import { CanonCamera, type CanonRawEvent } from '@vendors/canon/canon-camera'
import { withCanonPhotoMode } from '@vendors/canon/photo-mode'
import { openCanonRecordingMode } from '@vendors/canon/recording-mode'
import type { FocusCapability, LiveViewCapability, PhotoCapability } from '@vendors/generic/capability-groups'
import {
    cardObjectFile,
    cardSteps,
    classified,
    operationsAdvertised,
    overlayUnsupported,
    requireImage,
    requireNudge,
    requirePoint,
    storageHost,
    supported,
    unsupported,
} from '@vendors/generic/generic-operations'
import { type VendorRecording } from '@vendors/generic/recording-lifecycle'
import { readCameraStorages } from '@vendors/generic/storage'

/*
 * TRANSITIONAL (consolidation setup). Canon's operation code, moved verbatim from the per-area
 * capability modules. CanonCamera's driver-contract methods call these; fold each into the driver's
 * own method and delete it here.
 */

/** EOS GetEvent records: a value or its choices changed, or a new file reached the card. */
export function canonEventCodes(driver: CanonCamera, event: CameraEventName): readonly number[] {
    const events = driver.registry.events
    return event === 'settingsChanged'
        ? [events.CanonValueChanged.code, events.CanonAllowedValuesChanged.code]
        : [events.CanonObjectAddedEx.code, events.CanonObjectAddedEx64.code]
}

export function canonEvents(driver: CanonCamera, event: CameraEventName, handler: CameraEventHandler): () => void {
    const codes = canonEventCodes(driver, event)
    const listener = (raw: CanonRawEvent) => {
        if (codes.includes(raw.code)) handler()
    }
    driver.onRawEvent(listener)
    return () => driver.offRawEvent(listener)
}

/** Canon: still mode for a body in movie mode, then a release confirmed by the new file on the card. */
export function canonPhotoCapability(driver: CanonCamera): PhotoCapability {
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

export const CANON_FOCUS_DURATION_MILLISECONDS = 800

/**
 * EOS has one rectangle for the AF point and the magnify frame (EDSDK Evf_ZoomPosition, "the focus
 * and zoom border"). At 1× live view, moving it moves the AF point; the camera reads it back.
 */
export function canonFocusCapability(driver: CanonCamera): FocusCapability {
    const operations = driver.registry.operations

    /**
     * Moves the frame so its centre is at (x, y). A point needs unmagnified live view, where the frame
     * is the AF point; resetting only recentres it, which is also right while magnified.
     */
    async function placeFrame(operation: 'setFocusPoint' | 'resetFocusPoint', x: number, y: number): Promise<void> {
        const missing = [operations.CanonGetViewfinderData, operations.CanonViewfinderPosition].filter(
            definition => !driver.advertises(definition)
        )
        if (missing.length)
            throw new CameraUnsupportedError(
                operation,
                `The camera does not advertise ${missing.map(definition => definition.name).join(', ')}`
            )
        const position = await driver.getLiveViewPosition()
        if (operation === 'setFocusPoint' && position.magnification !== 1)
            throw new CameraUnsupportedError(operation, 'Canon places a focus point only in unmagnified live view')
        const visibleWidth = position.maximumX - position.minimumX + position.width
        const visibleHeight = position.maximumY - position.minimumY + position.height
        const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
        const originX = clamp(
            Math.round(position.minimumX + x * visibleWidth - position.width / 2),
            position.minimumX,
            position.maximumX
        )
        const originY = clamp(
            Math.round(position.minimumY + y * visibleHeight - position.height / 2),
            position.minimumY,
            position.maximumY
        )
        try {
            await driver.setLiveViewPosition(originX, originY)
        } catch (error) {
            if (error instanceof PTPResponseError) throw new CameraRefusedError(operation, error.message)
            throw new CameraOutcomeUnknownError(operation, error instanceof Error ? error.message : String(error))
        }
    }

    return {
        availability(capabilities) {
            const point = operationsAdvertised(capabilities, [
                operations.CanonGetViewfinderData,
                operations.CanonViewfinderPosition,
            ])
            const advertised = capabilities.advertisedOperations
            const canFocus =
                !advertised ||
                advertised.includes(operations.CanonDoAutofocus.code) ||
                advertised.includes(operations.CanonRemoteReleaseOn.code)
            return {
                autofocus: canFocus
                    ? supported
                    : unsupported('The camera advertises neither DoAf nor a remote half-press'),
                setFocusPoint: point,
                resetFocusPoint: point,
                nudgeFocus: unsupported('Manual focus steps are not available on Canon cameras yet'),
            }
        },

        async autofocus() {
            return driver.performAutofocus(CANON_FOCUS_DURATION_MILLISECONDS)
        },

        async setFocusPoint(x: number, y: number, options: FocusPointOptions) {
            requirePoint(x, y)
            await placeFrame('setFocusPoint', x, y)
            if (options.autofocus) await driver.performAutofocus(CANON_FOCUS_DURATION_MILLISECONDS)
        },

        async resetFocusPoint() {
            await placeFrame('resetFocusPoint', 0.5, 0.5)
        },

        async nudgeFocus(direction: FocusDirection, size: FocusStepSize) {
            requireNudge(direction, size)
            throw new CameraUnsupportedError('nudgeFocus', 'Manual focus steps are not available on Canon cameras yet')
        },

        settingWritten() {},
    }
}

/** Canon's viewfinder frames carry no focus frames Slate decodes yet; none is invented. */
export function canonLiveView(driver: CanonCamera): LiveViewCapability {
    return {
        availability: () => ({
            getLiveViewFrame: {
                supported: true,
                options: { overlay: { supported: false, reason: overlayUnsupported } },
            },
        }),
        async getLiveViewFrame({ overlay }) {
            if (overlay) throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
            const frame = await driver.captureLiveView({ includeData: true })
            return { jpeg: requireImage(frame.data), focusFrames: [] }
        },
    }
}

/** Canon's recording-mode helper, on the driver's own commands rather than Camera's vendor methods. */
export function canonHost(driver: CanonCamera) {
    return {
        driver,
        getCanonPropertyStates: async () => driver.listPropertyStates(),
        getCanonUnknownPropertyStates: async () => driver.listUnknownPropertyStates(),
        prepareCanonRecordingDestination: () => driver.prepareRecordingDestination(),
        enterMovieMode: () => driver.enterMovieMode(),
        leaveMovieMode: () => driver.leaveMovieMode(),
        setCanonManualExposureMode: () => driver.setManualExposureMode(),
        setIso: (value: string) => driver.setIso(value),
        setAperture: (value: string) => driver.setAperture(value),
        setShutterSpeed: (value: string) => driver.setShutterSpeed(value),
        setWhiteBalance: (value: string) => driver.setWhiteBalance(value),
    }
}

export function canonRecording(driver: CanonCamera, owner: Camera): VendorRecording {
    const host = storageHost(driver)
    return {
        ...cardSteps(driver, owner),
        async readState(): Promise<CameraRecordingState> {
            await driver.refreshEventProperties()
            const state = driver.listPropertyStates().find(state => state.name === 'CanonRecordingDestination')?.value
            return state === 'CARD' ? 'recording' : state === 'NONE' || state === 'SDRAM' ? 'idle' : 'unknown'
        },
        async checkCard() {
            const cards = await readCameraStorages(host)
            if (!cards.some(card => card.writable && card.freeBytes > 0))
                throw new CameraRefusedError(
                    'startRecording',
                    'Insert a writable memory card with free space before recording'
                )
        },
        // Card destination, movie mode and the photo exposure copied across; movie sound is left as set.
        prepare: async () => (await openCanonRecordingMode(canonHost(driver))).restore,
        sendStart: () => driver.sendStartRecording(),
        sendStop: () => driver.sendStopRecording(),
    }
}
