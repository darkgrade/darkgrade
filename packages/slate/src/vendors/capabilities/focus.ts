import { CanonCamera } from '@camera/canon-camera'
import type { CameraCapabilities, OperationAvailability } from '@camera/controls'
import type {
    FocusCapability,
    FocusDirection,
    FocusOperationName,
    FocusPointOptions,
    FocusResult,
    FocusStepSize,
} from '@camera/driver/focus'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import type { CameraDriverInstance } from '@camera/operations/context'
import { isMovableFocusArea, SonyCamera } from '@camera/sony-camera'
import { PTPResponseError } from '@core/ptp-errors'
import type { OperationDefinition } from '@ptp/types/operation'
import { controlValueNames } from '@vendors/control-properties'

const supported: OperationAvailability = { supported: true }
const unsupported = (reason: string): OperationAvailability => ({ supported: false, reason })

/** 0–1 from the top-left, or CameraRefusedError before anything is sent. */
function requirePoint(x: number, y: number): void {
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
        throw new CameraRefusedError('setFocusPoint', 'A focus point is 0–1 from the top-left of the picture')
}

function requireNudge(direction: FocusDirection, size: FocusStepSize): void {
    if (direction !== 'near' && direction !== 'far')
        throw new CameraRefusedError('nudgeFocus', 'Focus moves near or far')
    if (size !== 'small' && size !== 'medium' && size !== 'large')
        throw new CameraRefusedError('nudgeFocus', 'A focus step is small, medium or large')
}

/** Runs every restoration step even when one fails; reports all failures together. */
async function restoreAll(operation: string, steps: (() => Promise<void>)[]): Promise<void> {
    const failures: unknown[] = []
    for (const step of steps) {
        try {
            await step()
        } catch (error) {
            failures.push(error)
        }
    }
    if (failures.length === 1) throw failures[0]
    if (failures.length)
        throw new CameraOutcomeUnknownError(
            operation,
            failures.map(failure => (failure instanceof Error ? failure.message : String(failure))).join('; ')
        )
}

function operationsAdvertised(
    capabilities: CameraCapabilities,
    operations: readonly OperationDefinition[]
): OperationAvailability {
    const advertised = capabilities.advertisedOperations
    if (!advertised) return supported
    const missing = operations.filter(operation => !advertised.includes(operation.code))
    return missing.length
        ? unsupported(`The camera does not advertise ${missing.map(operation => operation.name).join(', ')}`)
        : supported
}

// ------------------------------------------------------------------------------------------- Sony

/** Sony's AF-area position grid (Camera Control PTP 3 reference, AF Area Position 0xd2dc). */
const SONY_GRID_WIDTH = 640
const SONY_GRID_HEIGHT = 480
const SONY_FOCUS_DURATION_MILLISECONDS = 800
const SONY_DEFAULT_SPOT = 'Flexible Spot M'
const SONY_TRACKING_PREFIX = 'Lock on AF '

/**
 * What a focus point changed on a Sony body, so `resetFocusPoint` can put it back: the focus area
 * it switched from (Wide, Zone and Center have no position) and subject detection it paused
 * (eye tracking would otherwise pull focus straight back to a face).
 */
interface SonyPointChanges {
    previousArea?: string
    placedArea?: string
    pausedSubjectDetection?: boolean
}

function sonyFocusCapability(driver: SonyCamera): FocusCapability {
    const properties = driver.registry.properties
    const changes: SonyPointChanges = {}
    let lastSpot = SONY_DEFAULT_SPOT

    /** Face and eye frames stay out of live view unless Face/Eye Frame Display is on. */
    async function showFaceFramesWhileDetecting(): Promise<void> {
        const states = await driver.refreshPropertyStates()
        const detection = states.find(state => state.name === properties.SubjectRecognitionInAF.name)
        const display = states.find(state => state.name === properties.FaceEyeFrameDisplay.name)
        if (detection?.value !== 'On' || !display || display.value === 'ON' || !display.writable) return
        await driver.set(properties.FaceEyeFrameDisplay, 'ON')
    }

    /** The spot to switch to from an area without a position, keeping Lock-on AF when it was on. */
    async function spotFor(area: string): Promise<string> {
        const states = await driver.refreshPropertyStates()
        const offered = (states.find(state => state.name === properties.FocusArea.name)?.allowedValues ?? []).map(String)
        const tracking = area.startsWith(SONY_TRACKING_PREFIX)
        const preferred = tracking ? `${SONY_TRACKING_PREFIX}${lastSpot}` : lastSpot
        if (offered.includes(preferred)) return preferred
        const alternative = offered.find(
            candidate => isMovableFocusArea(candidate) && candidate.startsWith(SONY_TRACKING_PREFIX) === tracking
        )
        if (!alternative)
            throw new CameraUnsupportedError('setFocusPoint', `The camera offers no movable focus area from ${area}`)
        return alternative
    }

    async function autofocus(): Promise<FocusResult> {
        await showFaceFramesWhileDetecting()
        return driver.autofocus(SONY_FOCUS_DURATION_MILLISECONDS)
    }

    return {
        availability(capabilities) {
            const area = capabilities.controls.focusArea
            const spot = area && sonyAreaLabel(area.value)
            if (spot && isMovableFocusArea(spot)) lastSpot = spot.replace(SONY_TRACKING_PREFIX, '')
            const point = area ? supported : unsupported('The camera reports no focus area to place a point in')
            return {
                autofocus: supported,
                setFocusPoint: point,
                resetFocusPoint: point,
                nudgeFocus: unsupported('Manual focus steps are not available on Sony cameras over USB yet'),
            }
        },

        autofocus,

        async setFocusPoint(x: number, y: number, options: FocusPointOptions) {
            requirePoint(x, y)
            const area = String(await driver.get(properties.FocusArea))
            if (isMovableFocusArea(area)) lastSpot = area.replace(SONY_TRACKING_PREFIX, '')
            else {
                const spot = await spotFor(area)
                await driver.set(properties.FocusArea, spot)
                changes.previousArea ??= area
                changes.placedArea = spot
            }
            if ((await driver.get(properties.SubjectRecognitionInAF)) === 'On') {
                await driver.set(properties.SubjectRecognitionInAF, 'Off')
                changes.pausedSubjectDetection = true
            }
            await driver.setAfAreaPosition(
                Math.round(x * (SONY_GRID_WIDTH - 1)),
                Math.round(y * (SONY_GRID_HEIGHT - 1))
            )
            if (options.autofocus) await driver.autofocus(SONY_FOCUS_DURATION_MILLISECONDS)
        },

        async resetFocusPoint() {
            await restoreAll('resetFocusPoint', [
                async () => {
                    const area = String(await driver.get(properties.FocusArea))
                    if (isMovableFocusArea(area))
                        await driver.setAfAreaPosition(Math.floor(SONY_GRID_WIDTH / 2), Math.floor(SONY_GRID_HEIGHT / 2))
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
            throw new CameraUnsupportedError('nudgeFocus', 'Manual focus steps are not available on Sony cameras over USB yet')
        },

        settingWritten(id: string) {
            if (id === 'focusArea') changes.previousArea = changes.placedArea = undefined
            if (id === 'subjectDetection') changes.pausedSubjectDetection = undefined
        },
    }
}

/** Sony's own label for a canonical focus area, from the vendor value names. */
function sonyAreaLabel(canonical: string): string | undefined {
    const names = controlValueNames('sony', 'focusArea')?.FocusArea ?? {}
    return Object.entries(names).find(([, name]) => name === canonical)?.[0]
}

// ------------------------------------------------------------------------------------------ Nikon

/**
 * MfDrive steps per nudge. Nikon's USB reference takes 1–32767 lens drive steps without a unit;
 * these follow the small/medium/large steps of tethering apps and are not yet bench-calibrated.
 */
const NIKON_FOCUS_STEPS: Record<FocusStepSize, number> = { small: 10, medium: 100, large: 500 }

function nikonFocusCapability(driver: NikonCamera): FocusCapability {
    const operations = driver.registry.operations
    const liveView = [operations.DeviceReady, operations.StartLiveView, operations.GetLiveViewImageEx]
    return {
        availability(capabilities) {
            const point = operationsAdvertised(capabilities, [operations.ChangeAfArea, ...liveView])
            return {
                autofocus: operationsAdvertised(capabilities, [operations.AfDrive, operations.AfDriveCancel, ...liveView]),
                setFocusPoint: point,
                resetFocusPoint: point,
                nudgeFocus: operationsAdvertised(capabilities, [operations.MfDrive, ...liveView]),
            }
        },

        async autofocus() {
            return (await driver.autofocus()).focusAcquired ? 'acquired' : 'not-acquired'
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

// ------------------------------------------------------------------------------------------ Canon

const CANON_FOCUS_DURATION_MILLISECONDS = 800

/**
 * EOS has one rectangle for the AF point and the magnify frame (EDSDK Evf_ZoomPosition, "the focus
 * and zoom border"). At 1× live view, moving it moves the AF point; the camera reads it back.
 */
function canonFocusCapability(driver: CanonCamera): FocusCapability {
    const operations = driver.registry.operations

    async function placeFrame(operation: string, x: number, y: number): Promise<void> {
        const missing = [operations.CanonGetViewfinderData, operations.CanonViewfinderPosition].filter(
            definition => !driver.advertises(definition)
        )
        if (missing.length)
            throw new CameraUnsupportedError(
                operation,
                `The camera does not advertise ${missing.map(definition => definition.name).join(', ')}`
            )
        const position = await driver.getLiveViewPosition()
        if (position.magnification !== 1)
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
                autofocus: canFocus ? supported : unsupported('The camera advertises neither DoAf nor a remote half-press'),
                setFocusPoint: point,
                resetFocusPoint: point,
                nudgeFocus: unsupported('Manual focus steps are not available on Canon cameras yet'),
            }
        },

        async autofocus() {
            return driver.autofocus(CANON_FOCUS_DURATION_MILLISECONDS)
        },

        async setFocusPoint(x: number, y: number, options: FocusPointOptions) {
            requirePoint(x, y)
            await placeFrame('setFocusPoint', x, y)
            if (options.autofocus) await driver.autofocus(CANON_FOCUS_DURATION_MILLISECONDS)
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

// -------------------------------------------------------------------------------------- Generic

/** Standard PTP has no autofocus or focus-point operation; every focus operation says so. */
function genericFocusCapability(): FocusCapability {
    const reason = 'This camera has no remote focus operations that Slate supports'
    const none = unsupported(reason)
    const refuse = async (operation: FocusOperationName): Promise<never> => {
        throw new CameraUnsupportedError(operation, reason)
    }
    return {
        availability: () => ({ autofocus: none, setFocusPoint: none, resetFocusPoint: none, nudgeFocus: none }),
        autofocus: () => refuse('autofocus'),
        setFocusPoint: () => refuse('setFocusPoint'),
        resetFocusPoint: () => refuse('resetFocusPoint'),
        nudgeFocus: () => refuse('nudgeFocus'),
        settingWritten() {},
    }
}

/**
 * Each vendor's focus capability. Every driver has one, so `getCapabilities().operations` always
 * says whether focusing is possible and why not; an operation the camera cannot do throws
 * CameraUnsupportedError with the same reason.
 */
export function focusCapability(driver: CameraDriverInstance, _owner: Camera): FocusCapability {
    if (driver instanceof SonyCamera) return sonyFocusCapability(driver)
    if (driver instanceof NikonCamera) return nikonFocusCapability(driver)
    if (driver instanceof CanonCamera) return canonFocusCapability(driver)
    return genericFocusCapability()
}
