import { CameraConfirmationError, confirmCameraValue } from '@camera/confirmation'
import type { CameraRecordingState } from '@camera/controls'
import type { Clip, VideoCapability } from '@camera/driver/video'
import {
    CameraClipNotFoundError,
    CameraOutcomeUnknownError,
    CameraRefusedError,
    CameraUnsupportedError,
} from '@camera/errors'
import { PTPError, PTPResponseError } from '@core/ptp-errors'

/**
 * What one vendor contributes to a recording; the lifecycle around it (`recordingCapability`) is
 * the same for every camera. Each step reuses the vendor's existing observations and commands.
 */
export interface VendorRecording {
    /** The camera's own recording state; unknown never counts as idle. */
    readState(): Promise<CameraRecordingState>
    /** Card checks that need no mode change; throws when the camera cannot record now. */
    checkCard?(): Promise<void>
    /**
     * Puts the camera in its recording setup (video mode, card destination, audio) from advertised
     * controls, restoring it itself if preparation fails. Resolves to the restore for after a stop.
     */
    prepare?(): Promise<() => Promise<void>>
    /** The card's object handles, before Record, so the new clip can be told apart. */
    listHandles(): Promise<Set<number>>
    /** Waits for a new finished movie that is not in `baseline`. */
    findClip(baseline: Set<number>): Promise<Clip>
    /**
     * For bodies whose object handles belong to one PTP session: the current session. A clip is
     * only looked for when Stop happens in the session that recorded the baseline.
     */
    handleSession?(): number | null
    /** Sends Record once. */
    sendStart(): Promise<void>
    /** Sends Stop once. */
    sendStop(): Promise<void>
    /** Releases a received Record that left the camera idle (Sony's movie button), without replaying it. */
    releaseIgnoredStart?(): Promise<void>
    /** Serializes a transition with this camera's control writes. */
    serialize<T>(work: () => Promise<T>): Promise<T>
}

interface RecordingSession {
    baseline: Set<number>
    handleSession: number | null | undefined
    restore?: () => Promise<void>
    stopConfirmed: boolean
    clip?: Clip
    clipError?: CameraClipNotFoundError
}

const startConfirmationMilliseconds = 5000
const stopConfirmationMilliseconds = 15000

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

function withCause<Failure extends Error>(failure: Failure, cause: unknown): Failure {
    failure.cause = cause
    return failure
}

function isPublicFailure(error: unknown): boolean {
    return (
        error instanceof CameraUnsupportedError ||
        error instanceof CameraRefusedError ||
        error instanceof CameraOutcomeUnknownError
    )
}

/**
 * A failure before Record was sent. Preparation restores what it changed, so a camera refusal or
 * a precondition leaves the camera as it was; a failed restore leaves its setup unknown.
 */
function preparationFailure(error: unknown): Error {
    if (isPublicFailure(error) && error instanceof Error) return error
    if (error instanceof AggregateError)
        return withCause(new CameraOutcomeUnknownError('startRecording', errorMessage(error)), error)
    if (error instanceof PTPError && !(error instanceof PTPResponseError))
        return withCause(new CameraOutcomeUnknownError('startRecording', errorMessage(error)), error)
    return withCause(new CameraRefusedError('startRecording', errorMessage(error)), error)
}

/** A failed Record or Stop: refused only when the camera answered no and stayed as it was. */
function transitionFailure(operation: string, error: unknown, unchanged: boolean): Error {
    if (isPublicFailure(error) && error instanceof Error) return error
    if (unchanged && !(error instanceof PTPError && !(error instanceof PTPResponseError)))
        return withCause(new CameraRefusedError(operation, errorMessage(error)), error)
    return withCause(new CameraOutcomeUnknownError(operation, errorMessage(error)), error)
}

/**
 * The recording lifecycle every camera shares: Record and Stop are each sent once and confirmed
 * by polling the camera's own state; the setup is restored only after a confirmed idle; Stop is
 * always accepted. Start and stop are serialized with each other, while preparation and restore
 * run outside the control queue so they can use the camera's ordinary control writes.
 */
export function recordingCapability(vendor: VendorRecording): VideoCapability {
    let session: RecordingSession | undefined
    let transitions: Promise<unknown> = Promise.resolve()
    const inOrder = <T>(work: () => Promise<T>): Promise<T> => {
        const next = transitions.catch(() => undefined).then(work)
        transitions = next
        return next
    }
    const observe = (): Promise<CameraRecordingState> => vendor.readState().catch(() => 'unknown' as const)

    async function restoreAfterFailedStart(prepared: RecordingSession, failure: unknown): Promise<void> {
        try {
            await vendor.releaseIgnoredStart?.()
        } catch (release) {
            // Keep the session: Stop still has a press to release.
            throw withCause(
                new CameraOutcomeUnknownError('startRecording', `${errorMessage(failure)}; releasing the ignored Record failed: ${errorMessage(release)}`),
                failure
            )
        }
        session = undefined
        try {
            await prepared.restore?.()
        } catch (restore) {
            // Nothing was recorded; stopRecording retries the restore and then reports no clip.
            session = {
                ...prepared,
                stopConfirmed: true,
                clipError: new CameraClipNotFoundError('stopRecording', 'Record did not start, so there is no new clip'),
            }
            throw withCause(
                new CameraOutcomeUnknownError('startRecording', `${errorMessage(failure)}; putting the camera back failed: ${errorMessage(restore)}`),
                new AggregateError([failure, restore])
            )
        }
    }

    async function start(): Promise<void> {
        if (session)
            throw new CameraRefusedError(
                'startRecording',
                session.stopConfirmed
                    ? 'The last recording stopped but the camera setup is not restored; call stopRecording to finish it'
                    : 'A recording is already in progress; stop it before starting another'
            )
        const state = await vendor.readState()
        if (state === 'stopping')
            await confirmCameraValue('record_start', 'idle', () => vendor.readState(), startConfirmationMilliseconds)
        else if (state !== 'idle')
            throw new CameraRefusedError('startRecording', `The camera reports ${state}, not idle; Record was not sent`)
        let restore: (() => Promise<void>) | undefined
        let baseline: Set<number>
        try {
            await vendor.checkCard?.()
            // The card index before any mode change: the a7 V answered GetStorageIDs with 0x2013
            // (store not available) right after selecting a movie mode (2026-11-24).
            baseline = await vendor.listHandles()
            restore = await vendor.prepare?.()
        } catch (error) {
            if (restore)
                try {
                    await restore()
                } catch (cleanup) {
                    throw preparationFailure(new AggregateError([error, cleanup], `${errorMessage(error)}; restoring: ${errorMessage(cleanup)}`))
                }
            throw preparationFailure(error)
        }
        const prepared: RecordingSession = {
            baseline,
            handleSession: vendor.handleSession?.(),
            restore,
            stopConfirmed: false,
        }
        session = prepared
        try {
            await vendor.serialize(async () => {
                await vendor.sendStart()
                await confirmCameraValue('record_start', 'recording', () => vendor.readState(), startConfirmationMilliseconds)
            })
        } catch (error) {
            const observed = error instanceof CameraConfirmationError ? error.observed : await observe()
            // Recording or unknown keeps the prepared setup and the session, so Stop stays available.
            if (observed !== 'idle') throw transitionFailure('startRecording', error, false)
            await restoreAfterFailedStart(prepared, error)
            throw transitionFailure('startRecording', error, true)
        }
    }

    async function finish(stopped: RecordingSession): Promise<Clip> {
        try {
            await stopped.restore?.()
        } catch (error) {
            const where = stopped.clip ? ` and ${stopped.clip.name} is on the card` : ''
            throw withCause(
                new CameraOutcomeUnknownError(
                    'stopRecording',
                    `Recording stopped${where}, but putting the camera back failed: ${errorMessage(error)}. Call stopRecording again to retry.`
                ),
                error
            )
        }
        session = undefined
        if (stopped.clipError || !stopped.clip)
            throw stopped.clipError ?? new CameraClipNotFoundError('stopRecording', 'Recording stopped, but no new clip was found')
        return stopped.clip
    }

    async function locateClip(stopped: RecordingSession): Promise<void> {
        if (stopped.handleSession !== undefined && stopped.handleSession !== vendor.handleSession?.()) {
            stopped.clipError = new CameraClipNotFoundError(
                'stopRecording',
                'Recording stopped, but the camera connection was renewed since it started, so its clip cannot be identified; it remains on the card'
            )
            return
        }
        try {
            stopped.clip = await vendor.findClip(stopped.baseline)
        } catch (error) {
            stopped.clipError = withCause(new CameraClipNotFoundError('stopRecording', errorMessage(error)), error)
        }
    }

    async function stop(): Promise<Clip> {
        if (session?.stopConfirmed) return finish(session)
        const before = await observe()
        if (!session && before === 'idle')
            throw new CameraClipNotFoundError('stopRecording', 'The camera is not recording, so there is no new clip')
        try {
            await vendor.serialize(async () => {
                await vendor.sendStop()
                await confirmCameraValue('record_stop', 'idle', () => vendor.readState(), stopConfirmationMilliseconds)
            })
        } catch (error) {
            // A lost Stop reply can still leave a confirmed idle camera; anything else keeps Stop available.
            if ((await observe()) !== 'idle') throw transitionFailure('stopRecording', error, false)
        }
        const stopped = session
        if (!stopped)
            throw new CameraClipNotFoundError(
                'stopRecording',
                'Recording stopped; it was not started on this connection, so its clip cannot be identified. It remains on the card'
            )
        stopped.stopConfirmed = true
        await locateClip(stopped)
        return finish(stopped)
    }

    return {
        getRecordingState: () => vendor.readState(),
        startRecording: () => inOrder(start),
        stopRecording: () => inOrder(stop),
    }
}
