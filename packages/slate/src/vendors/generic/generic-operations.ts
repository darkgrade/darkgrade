import { cameraContext } from '@camera/camera-context'
import type { CameraCapabilities, OperationAvailability } from '@camera/controls'
import type { Clip, FocusDirection, FocusStepSize } from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import { PTPDecodeError } from '@core/ptp-errors'
import type { OperationDefinition } from '@ptp/types/operation'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import { readCameraObjectHandles, waitForNewCameraMovie } from '@vendors/generic/storage'
import { messageOf } from '@vendors/generic/typed-failure'

/*
 * TRANSITIONAL (consolidation setup): the small helpers each brand's operations share. Standard
 * PTP behaviour itself is in GenericCamera; the capture helpers are re-exported from their own
 * module until the brands import them from there.
 */
export { cardObjectFile, classified, describedFile, type DriverCapture } from '@vendors/generic/shutter-outcome'


export const supported: OperationAvailability = { supported: true }
export const unsupported = (reason: string): OperationAvailability => ({ supported: false, reason })

/** 0–1 from the top-left, or CameraRefusedError before anything is sent. */
export function requirePoint(x: number, y: number): void {
    if (![x, y].every(value => Number.isFinite(value) && value >= 0 && value <= 1))
        throw new CameraRefusedError('setFocusPoint', 'A focus point is 0–1 from the top-left of the picture')
}

export function requireNudge(direction: FocusDirection, size: FocusStepSize): void {
    if (direction !== 'near' && direction !== 'far')
        throw new CameraRefusedError('nudgeFocus', 'Focus moves near or far')
    if (size !== 'small' && size !== 'medium' && size !== 'large')
        throw new CameraRefusedError('nudgeFocus', 'A focus step is small, medium or large')
}

/** Runs every restoration step even when one fails; reports all failures together. */
export async function restoreAll(operation: string, steps: (() => Promise<void>)[]): Promise<void> {
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
            failures.map(messageOf).join('; ')
        )
}

export function operationsAdvertised(
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

export const overlayUnsupported = 'This camera does not send its on-screen display'

export function requireImage(data: Uint8Array | undefined): Uint8Array {
    if (!data?.length) throw new PTPDecodeError('The camera returned no live-view image')
    return data
}

export const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Sony movies can take a while to close on the card after a long 4K take. */
export const clipFinalizationMilliseconds = 30000
/** PTP ObjectInfo's size when the real one needs a 64-bit query. */
export const unstatedSize = 0xffffffff

function clipFrom(handle: number, name: unknown, sizeBytes: number | undefined): Clip {
    return {
        mediaId: String(handle),
        name: String(name),
        ...(sizeBytes !== undefined && Number.isSafeInteger(sizeBytes) && sizeBytes !== unstatedSize
            ? { sizeBytes }
            : {}),
    }
}

/** What every PTP driver shares: the card's handles and the new finished movie. */
export function cardSteps(driver: GenericCamera, owner: Camera) {
    return {
        listHandles: () => readCameraObjectHandles(driver),
        async findClip(baseline: Set<number>): Promise<Clip> {
            const movie = await waitForNewCameraMovie(driver, baseline, clipFinalizationMilliseconds)
            return clipFrom(movie.handle, movie.filename, Number(movie.objectCompressedSize))
        },
        handleSession: () => driver.sessionId,
        serialize: <T>(work: () => Promise<T>) => cameraContext(owner).controlsQueue.run('camera', work),
    }
}
