import type { ConfirmedPhotoFile } from '@camera/driver'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import type { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { encodeMediaId, type MediaReference } from '@vendors/generic/media-id'

const operation = 'takePhoto'

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function withCause<Wrapped extends Error>(wrapped: Wrapped, cause: unknown): Wrapped {
    wrapped.cause = cause
    return wrapped
}

const typedOutcome = (error: unknown) =>
    error instanceof CameraOutcomeUnknownError ||
    error instanceof CameraRefusedError ||
    error instanceof CameraUnsupportedError

/** The camera said no to the focus or shutter command, so nothing was taken. The message is kept. */
export function shutterRefused(error: unknown): Error {
    if (typedOutcome(error)) return error instanceof Error ? error : new Error(messageOf(error))
    return withCause(new CameraRefusedError(operation, messageOf(error)), error)
}

/**
 * Once a shutter command has been sent, a photo may exist whatever went wrong next: report it as
 * unknown, never as a failure the caller may simply retry. The message is kept.
 */
export function shutterOutcomeUnknown(error: unknown): CameraOutcomeUnknownError {
    if (error instanceof CameraOutcomeUnknownError) return error
    return withCause(new CameraOutcomeUnknownError(operation, messageOf(error)), error)
}

/** Runs the part of a capture that follows a sent shutter command (confirmation and transfer). */
export async function afterShutterRelease<Result>(work: () => Promise<Result>): Promise<Result> {
    try {
        return await work()
    } catch (error) {
        throw shutterOutcomeUnknown(error)
    }
}

/**
 * The one outcome a capture with restoration failures reports: an unknown shutter outcome
 * outranks a refusal, which outranks unsupported. Undefined when neither the error nor any error
 * inside it is one of the three outcomes.
 */
export function strongestShutterOutcome(error: unknown): Error | undefined {
    if (!(error instanceof AggregateError)) return typedOutcome(error) && error instanceof Error ? error : undefined
    const inner: unknown[] = error.errors
    const pick = (type: typeof CameraOutcomeUnknownError | typeof CameraRefusedError | typeof CameraUnsupportedError) =>
        inner.find(candidate => candidate instanceof type)
    const strongest = pick(CameraOutcomeUnknownError) ?? pick(CameraRefusedError) ?? pick(CameraUnsupportedError)
    if (strongest instanceof CameraOutcomeUnknownError)
        return withCause(new CameraOutcomeUnknownError(operation, error.message), error)
    if (strongest instanceof CameraRefusedError)
        return withCause(new CameraRefusedError(operation, error.message), error)
    if (strongest instanceof CameraUnsupportedError)
        return withCause(new CameraUnsupportedError(operation, error.message), error)
    return undefined
}

/**
 * A capture failure as one of the three outcomes. Drivers type every failure that follows a sent
 * shutter command, so an untyped one happened before it (preparation, a mode change, a baseline
 * read) and took nothing; once the photo was confirmed, an untyped failure is a mode restoration
 * that failed after it, which must never read as a refusal the caller may simply retry.
 */
export function photoOutcome(error: unknown, photoConfirmed: boolean): Error {
    const typed = strongestShutterOutcome(error)
    if (typed) return typed
    if (photoConfirmed)
        return withCause(
            new CameraOutcomeUnknownError(operation, `The photo was taken, but restoring the camera afterwards failed: ${messageOf(error)}`),
            error
        )
    return withCause(new CameraRefusedError(operation, `No photo was taken: ${messageOf(error)}`), error)
}

/**
 * For a driver whose own restoration follows the release: once a release may have been sent, an
 * untyped failure (restoring a setting or mode) is an unknown outcome, never a refusal.
 */
export function afterPossibleRelease(error: unknown, releaseSent: boolean): unknown {
    if (!releaseSent || strongestShutterOutcome(error)) return error
    return shutterOutcomeUnknown(error)
}

export type DriverCapture = { info?: ObjectInfo; data?: Uint8Array; objectHandle?: number }

/** The driver's answer for one release, checked: a file Slate cannot name is not a confirmed photo. */
export function describedFile(capture: DriverCapture, wantsData: boolean): { info: ObjectInfo; data?: Uint8Array } {
    const info = capture.info
    if (!info?.filename || !Number.isSafeInteger(info.objectCompressedSize) || info.objectCompressedSize <= 0)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            'The shutter was released, but the camera described no new photo file'
        )
    if (wantsData && capture.data?.length !== info.objectCompressedSize)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            'The photo was taken, but its transfer did not match the size the camera reported'
        )
    return { info, ...(wantsData && capture.data ? { data: capture.data } : {}) }
}

/** A card object found through standard PTP handles, named with the id `listMedia()` gives it. */
export function cardObjectFile(capture: DriverCapture, wantsData: boolean): ConfirmedPhotoFile {
    const { info, data } = describedFile(capture, wantsData)
    if (capture.objectHandle === undefined)
        throw new CameraOutcomeUnknownError(
            'takePhoto',
            `The photo ${info.filename} was taken, but the camera did not name its card object`
        )
    const sizeBytes = info.objectCompressedSize
    const reference: MediaReference = {
        source: 'object',
        storageId: info.storageID,
        objectHandle: capture.objectHandle,
        name: info.filename,
        sizeBytes,
    }
    return { mediaId: encodeMediaId(reference), name: info.filename, sizeBytes, ...(data && { data }) }
}

/**
 * Runs one capture and reports a failure as one of the three outcomes. `confirmed` is called once
 * the driver has confirmed the photo, so a mode restoration that fails after it is never a refusal.
 */
export async function classified(
    capture: (confirmed: () => void) => Promise<ConfirmedPhotoFile>
): Promise<ConfirmedPhotoFile> {
    let photoConfirmed = false
    try {
        return await capture(() => (photoConfirmed = true))
    } catch (error) {
        throw photoOutcome(error, photoConfirmed)
    }
}
