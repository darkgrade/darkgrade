import type { CameraRecordingState, OperationAvailability } from '@camera/controls'
import type {
    CameraEventHandler,
    FocusDirection,
    FocusFrame,
    FocusPointOptions,
    FocusStepSize,
    LiveViewFrame,
} from '@camera/driver'
import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { Logger } from '@core/logger'
import { PTPResponseError } from '@core/ptp-errors'
import type { EventParams } from '@ptp/types/type-helpers'
import { controlValueNames } from '@vendors/control-properties'
import type { FocusCapability, LiveViewCapability, PhotoCapability } from '@vendors/generic/capability-groups'
import {
    cardSteps,
    classified,
    describedFile,
    overlayUnsupported,
    requireImage,
    requireNudge,
    requirePoint,
    restoreAll,
    storageHost,
    supported,
    unsupported,
    wait,
} from '@vendors/generic/generic-operations'
import { type VendorRecording } from '@vendors/generic/recording-lifecycle'
import { afterShutterRelease } from '@vendors/generic/shutter-outcome'
import { findSonyCardFile, markSonyCardIndex, type SonyCardIndexMark } from '@vendors/sony/media'
import { openSonyRecordingMode, sonyPhotoModeDriver, withSonyPhotoMode } from '@vendors/sony/photo-mode'
import { readSonyPtpRecordingState } from '@vendors/sony/ptp-video-recording'
import { isMovableFocusArea, SonyCamera } from '@vendors/sony/sony-camera'

/*
 * TRANSITIONAL (consolidation setup). Sony's operation code, moved verbatim from the per-area
 * capability modules. SonyCamera's driver-contract methods call these; fold each into the driver's
 * own method and delete it here.
 */

/**
 * A Sony body saving to its card sends no ObjectAdded; its card index announces the file instead.
 * Event type 1 followed each new photo on an α7 V (bench, 2026-11-24); other types are not mapped.
 */
export const SONY_CONTENT_ADDED_EVENT_TYPE = 1

export function sonyCardIndexAdditions(driver: SonyCamera, handler: CameraEventHandler): () => void {
    const definition = driver.registry.events.SDIE_ContentInfoListChanged
    const listener = (params: EventParams<typeof definition>) => {
        if (Number(params['Event Type']) === SONY_CONTENT_ADDED_EVENT_TYPE) handler()
    }
    driver.on(definition, listener)
    return () => driver.off(definition, listener)
}

/** How long Sony's card index may take to list a photo its camera already announced. */
export const SONY_CARD_INDEX_TIMEOUT_MS = 10_000
export const SONY_CARD_INDEX_POLL_MS = 250

/** Where Sony's card index ends before the release, or undefined when the body offers none. */
export async function markCardIndex(driver: SonyCamera): Promise<SonyCardIndexMark | undefined> {
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
export async function sonyCardFile(
    driver: SonyCamera,
    name: string,
    mark: SonyCardIndexMark
): Promise<{ mediaId: string; sizeBytes?: number }> {
    const deadline = Date.now() + SONY_CARD_INDEX_TIMEOUT_MS
    for (;;) {
        const item = await findSonyCardFile(driver, 'takePhoto', name, mark)
        if (item) return { mediaId: item.id, ...(item.sizeBytes !== undefined && { sizeBytes: item.sizeBytes }) }
        if (Date.now() >= deadline)
            throw new Error(
                `The camera announced ${name}, but its card index did not list it within ${SONY_CARD_INDEX_TIMEOUT_MS / 1000} seconds`
            )
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
export function sonyPhotoCapability(driver: SonyCamera): PhotoCapability {
    return {
        takePhoto: ({ autofocus, destination }) =>
            classified(async confirmed => {
                await driver.returnToShooting()
                const mark = await markCardIndex(driver)
                const capture = await withSonyPhotoMode(sonyPhotoModeDriver(driver), async () => {
                    const captured = await driver.captureImage({
                        autofocus,
                        includeInfo: true,
                        includeData: true,
                        destination: 'card',
                    })
                    confirmed()
                    return captured
                })
                const { info, data } = describedFile(capture, destination === 'computer')
                const card: { mediaId?: string; sizeBytes?: number } = mark
                    ? await afterShutterRelease(() => sonyCardFile(driver, info.filename, mark))
                    : {}
                return {
                    ...card,
                    name: info.filename,
                    sizeBytes: card.sizeBytes ?? info.objectCompressedSize,
                    ...(data && { data }),
                }
            }),
    }
}

/** Sony's AF-area position grid (Camera Control PTP 3 reference, AF Area Position 0xd2dc). */
export const SONY_GRID_WIDTH = 640
export const SONY_GRID_HEIGHT = 480
export const SONY_FOCUS_DURATION_MILLISECONDS = 800
export const SONY_DEFAULT_SPOT = 'Flexible Spot M'
/** Lock-on AF areas on current bodies (0x02xx), Tracking Flexible Spot on older ones (0x03xx). */
export const SONY_TRACKING_PREFIXES = ['Lock on AF ', 'Tracking '] as const

export function sonyTrackingPrefix(area: string): string | undefined {
    return SONY_TRACKING_PREFIXES.find(prefix => area.startsWith(prefix))
}

/** A spot without its tracking prefix: "Lock on AF Flexible Spot M" and "Tracking Flexible Spot M" are "Flexible Spot M". */
export function sonyPlainArea(area: string): string {
    return area.slice(sonyTrackingPrefix(area)?.length ?? 0)
}

/**
 * What a focus point changed on a Sony body, so `resetFocusPoint` can put it back: the focus area
 * it switched from (Wide, Zone and Center have no position) and subject detection it paused
 * (eye tracking would otherwise pull focus straight back to a face).
 */
export interface SonyPointChanges {
    previousArea?: string
    placedArea?: string
    pausedSubjectDetection?: boolean
}

/** What the focus capability remembers about one PTP session; a new session starts fresh. */
export interface SonyFocusSession {
    sessionId: number | null
    changes: SonyPointChanges
    /** The spot size last active on the camera, without its tracking prefix. */
    lastSpot: string
    /** Face/Eye Frame Display was checked since subject detection was last seen turning on. */
    faceFramesChecked: boolean
}

export function sonyFocusCapability(driver: SonyCamera, logger: Logger): FocusCapability {
    const properties = driver.registry.properties
    const freshSession = (sessionId: number | null): SonyFocusSession => ({
        sessionId,
        changes: {},
        lastSpot: SONY_DEFAULT_SPOT,
        faceFramesChecked: false,
    })
    let remembered = freshSession(driver.sessionId)

    /** This session's memory. A point placed before a disconnect never changes a later session. */
    function session(): SonyFocusSession {
        if (remembered.sessionId !== driver.sessionId) remembered = freshSession(driver.sessionId)
        return remembered
    }

    /**
     * Face and eye frames stay out of live view unless Face/Eye Frame Display is on, so eye tracking
     * would show nothing. Turned on once per session while subject detection is on, from the
     * property states the driver last read (no reads of its own). This is display only: a body that
     * refuses keeps its own setting, and the refusal is logged rather than raised.
     */
    async function showFaceFramesWhileDetecting(): Promise<void> {
        const current = session()
        if (current.faceFramesChecked) return
        const states = driver.listPropertyStates()
        const detection = states.find(state => state.name === properties.SubjectRecognitionInAF.name)
        if (detection?.value !== 'On') return
        current.faceFramesChecked = true
        const display = states.find(state => state.name === properties.FaceEyeFrameDisplay.name)
        if (!display || display.value === 'ON' || !display.writable) return
        try {
            await driver.set(properties.FaceEyeFrameDisplay, 'ON')
        } catch (error) {
            if (!(error instanceof PTPResponseError)) throw error
            logger.addLog({
                type: 'console',
                level: 'warn',
                consoleLevel: 'warn',
                args: [`Sony Face/Eye Frame Display stayed off: ${error.message}`],
            })
        }
    }

    /** The spot to switch to from an area without a position, keeping tracking when it was on. */
    async function spotFor(area: string): Promise<string> {
        const states = await driver.refreshPropertyStates()
        const offered = (states.find(state => state.name === properties.FocusArea.name)?.allowedValues ?? []).map(
            String
        )
        const tracking = sonyTrackingPrefix(area) !== undefined
        const { lastSpot } = session()
        const preferred = tracking ? SONY_TRACKING_PREFIXES.map(prefix => `${prefix}${lastSpot}`) : [lastSpot]
        const match = preferred.find(candidate => offered.includes(candidate))
        if (match) return match
        const alternative = offered.find(
            candidate => isMovableFocusArea(candidate) && (sonyTrackingPrefix(candidate) !== undefined) === tracking
        )
        if (!alternative)
            throw new CameraUnsupportedError('setFocusPoint', `The camera offers no movable focus area from ${area}`)
        return alternative
    }

    return {
        availability(capabilities) {
            const area = capabilities.controls.focusArea
            const spot = area && sonyAreaLabel(area.value)
            if (spot && isMovableFocusArea(spot)) session().lastSpot = sonyPlainArea(spot)
            const point = area ? supported : unsupported('The camera reports no focus area to place a point in')
            return {
                autofocus: supported,
                setFocusPoint: point,
                resetFocusPoint: point,
                nudgeFocus: unsupported('Manual focus steps are not available on Sony cameras over USB yet'),
            }
        },

        async capabilitiesObserved(capabilities) {
            if (capabilities.controls.subjectDetection?.value === 'On') await showFaceFramesWhileDetecting()
        },

        async autofocus() {
            await showFaceFramesWhileDetecting()
            return driver.performAutofocus(SONY_FOCUS_DURATION_MILLISECONDS)
        },

        async setFocusPoint(x: number, y: number, options: FocusPointOptions) {
            requirePoint(x, y)
            const current = session()
            const area = String(await driver.get(properties.FocusArea))
            if (isMovableFocusArea(area)) current.lastSpot = sonyPlainArea(area)
            else {
                const spot = await spotFor(area)
                await driver.set(properties.FocusArea, spot)
                current.changes.previousArea ??= area
                current.changes.placedArea = spot
            }
            if ((await driver.get(properties.SubjectRecognitionInAF)) === 'On') {
                await driver.set(properties.SubjectRecognitionInAF, 'Off')
                current.changes.pausedSubjectDetection = true
            }
            await driver.setAfAreaPosition(
                Math.round(x * (SONY_GRID_WIDTH - 1)),
                Math.round(y * (SONY_GRID_HEIGHT - 1))
            )
            if (options.autofocus) await driver.performAutofocus(SONY_FOCUS_DURATION_MILLISECONDS)
        },

        async resetFocusPoint() {
            const { changes } = session()
            await restoreAll('resetFocusPoint', [
                async () => {
                    const area = String(await driver.get(properties.FocusArea))
                    if (isMovableFocusArea(area))
                        await driver.setAfAreaPosition(
                            Math.floor(SONY_GRID_WIDTH / 2),
                            Math.floor(SONY_GRID_HEIGHT / 2)
                        )
                },
                async () => {
                    const { previousArea, placedArea } = changes
                    changes.previousArea = changes.placedArea = undefined
                    // Only undo the switch a focus point made: an area chosen since then stays.
                    if (previousArea && String(await driver.get(properties.FocusArea)) === placedArea)
                        await driver.set(properties.FocusArea, previousArea)
                },
                async () => {
                    const paused = changes.pausedSubjectDetection
                    changes.pausedSubjectDetection = undefined
                    if (paused && (await driver.get(properties.SubjectRecognitionInAF)) === 'Off')
                        await driver.set(properties.SubjectRecognitionInAF, 'On')
                },
            ])
        },

        async nudgeFocus(direction: FocusDirection, size: FocusStepSize) {
            requireNudge(direction, size)
            throw new CameraUnsupportedError(
                'nudgeFocus',
                'Manual focus steps are not available on Sony cameras over USB yet'
            )
        },

        settingWritten(id: string) {
            const current = session()
            if (id === 'focusArea') current.changes.previousArea = current.changes.placedArea = undefined
            if (id === 'subjectDetection') {
                current.changes.pausedSubjectDetection = undefined
                current.faceFramesChecked = false
            }
        },
    }
}

/** Sony's own label for a canonical focus area, from the vendor value names. */
export function sonyAreaLabel(canonical: string): string | undefined {
    const names = controlValueNames('sony', 'focusArea')?.FocusArea ?? {}
    return Object.entries(names).find(([, name]) => name === canonical)?.[0]
}

/** After this long without an overlay request, the next frame switches the camera's overlay output off. */
export const OVERLAY_IDLE_MILLISECONDS = 2_000

/**
 * Sony live view: waits for the camera's next frame before asking (pacing, measured by the driver),
 * so a caller never polls in a tight loop, and the frame request itself is one transaction. The
 * on-screen display output is switched on by the first overlay request and off once overlays stop.
 */
export class SonyLiveView implements LiveViewCapability {
    /** True until the camera confirms its overlay output is off. */
    private overlayOutput = false
    /** When the output may next be switched off: an idle interval after the last overlay request or failed attempt. */
    private switchOffDueMs = 0

    constructor(
        private readonly driver: SonyCamera,
        private readonly logger: Logger
    ) {}

    availability(): Record<'getLiveViewFrame', OperationAvailability> {
        const states = this.driver.listPropertyStates()
        const status = states.find(state => state.name === 'LiveViewStatus')?.value
        const overlay: OperationAvailability = states.some(state => state.name === 'OsdImageMode')
            ? { supported: true }
            : { supported: false, reason: overlayUnsupported }
        if (status === 'NOT_SUPPORTED')
            return {
                getLiveViewFrame: {
                    supported: false,
                    reason: 'The camera reports live view unavailable in its current mode',
                    options: { overlay },
                },
            }
        return { getLiveViewFrame: { supported: true, options: { overlay } } }
    }

    async getLiveViewFrame({ overlay }: { overlay: boolean }): Promise<LiveViewFrame> {
        const untilNextFrameMilliseconds = this.driver.millisecondsUntilNextLiveViewFrame()
        if (untilNextFrameMilliseconds > 0) await wait(untilNextFrameMilliseconds)
        let frame: Awaited<ReturnType<SonyCamera['captureLiveView']>>
        try {
            frame = await this.driver.captureLiveView({ includeInfo: false })
        } catch (error) {
            if (error instanceof Error && /unavailable in the current camera mode/.test(error.message))
                throw new CameraUnsupportedError('getLiveViewFrame', error.message)
            throw error
        }
        const focusFrames: FocusFrame[] = (frame.sonyFocalFrames ?? []).map(
            ({ kind, focused, centerX, centerY, width, height }) => ({ kind, focused, centerX, centerY, width, height })
        )
        const jpeg = requireImage(frame.data)
        if (overlay) return { jpeg, focusFrames, overlay: await this.readOverlay() }
        if (this.overlayOutput && Date.now() > this.switchOffDueMs) await this.switchOverlayOutputOff()
        return { jpeg, focusFrames }
    }

    /**
     * The frame already read is never lost to this: a failed or unconfirmed switch-off is logged
     * and tried again on a frame one idle interval later.
     */
    private async switchOverlayOutputOff(): Promise<void> {
        try {
            await this.driver.setOsdImageMode(false)
            this.overlayOutput = false
        } catch (error) {
            this.switchOffDueMs = Date.now() + OVERLAY_IDLE_MILLISECONDS
            this.logger.addLog({
                type: 'console',
                level: 'warn',
                consoleLevel: 'warn',
                args: [
                    `Switching the camera's overlay output off was not confirmed; trying again later: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                ],
            })
        }
    }

    private async readOverlay(): Promise<{ png: Uint8Array }> {
        if (!this.driver.listPropertyStates().some(state => state.name === 'OsdImageMode'))
            throw new CameraUnsupportedError('getLiveViewFrame', overlayUnsupported)
        this.switchOffDueMs = Date.now() + OVERLAY_IDLE_MILLISECONDS
        this.overlayOutput = true
        const { image } = await this.driver.captureOsdImage()
        return { png: image }
    }
}

export function sonyHost(driver: SonyCamera) {
    return {
        ...storageHost(driver),
        getSonyPropertyStates: async () => {
            await driver.refreshPropertyStates()
            return driver.listPropertyStates()
        },
    }
}

/** Native Sony PTP: 0xd21d is 0 idle and 1 recording; 2 (failed) and 3 (interval waiting) are neither. */
export function sonyRecording(driver: SonyCamera, owner: Camera): VendorRecording {
    const host = sonyHost(driver)
    return {
        ...cardSteps(driver, owner),
        async readState(): Promise<CameraRecordingState> {
            const state = await readSonyPtpRecordingState(host)
            return state === 0 ? 'idle' : state === 1 ? 'recording' : 'unknown'
        },
        // Selects the advertised movie mode and checks the movie card's remaining time in it.
        prepare: async () => (await openSonyRecordingMode(owner)).restore,
        sendStart: () => driver.sendStartRecording(),
        sendStop: () => driver.sendStopRecording(),
        // The movie button is a press and release; Stop releases a press the body ignored.
        releaseIgnoredStart: () => driver.sendStopRecording(),
    }
}
