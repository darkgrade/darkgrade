import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'

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
 * outranks a refusal, which outranks unsupported. Other errors are returned unchanged.
 */
export function strongestShutterOutcome(error: unknown): unknown {
    if (!(error instanceof AggregateError)) return error
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
    return error
}
