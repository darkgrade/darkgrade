import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'

/** The three outcomes a driver reports a failed camera operation as. */
export type TypedFailure = CameraUnsupportedError | CameraRefusedError | CameraOutcomeUnknownError

export const isTypedFailure = (error: unknown): error is TypedFailure =>
    error instanceof CameraUnsupportedError || error instanceof CameraRefusedError || error instanceof CameraOutcomeUnknownError

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export function withCause<Failure extends Error>(failure: Failure, cause: unknown): Failure {
    failure.cause = cause
    return failure
}
