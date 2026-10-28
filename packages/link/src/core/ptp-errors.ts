/**
 * Typed failures raised by @darkgrade/link when a camera, cable or transport misbehaves. Callers can
 * branch on the class (or `kind`) instead of parsing messages, and every one carries the operation
 * and transaction it happened in.
 */

export interface PTPErrorContext {
    operation?: string
    transactionId?: number
    cause?: unknown
}

export class PTPError extends Error {
    readonly operation?: string
    readonly transactionId?: number

    constructor(message: string, context: PTPErrorContext = {}) {
        super(context.operation ? `${context.operation}: ${message}` : message, { cause: context.cause })
        this.name = 'PTPError'
        this.operation = context.operation
        this.transactionId = context.transactionId
    }
}

/** A transport phase did not complete in time. The camera may still be busy with the transaction. */
export class PTPTimeoutError extends PTPError {
    constructor(
        readonly phase: 'send' | 'data' | 'response',
        readonly timeoutMilliseconds: number,
        context: PTPErrorContext = {}
    ) {
        super(`no ${phase} phase completion within ${timeoutMilliseconds} ms`, context)
        this.name = 'PTPTimeoutError'
    }
}

export type PTPProtocolViolation =
    | 'short-container'
    | 'truncated-container'
    | 'unexpected-container-type'
    | 'transaction-mismatch'
    | 'operation-mismatch'

/** The camera answered with bytes that break ISO 15740 container framing for this transaction. */
export class PTPProtocolError extends PTPError {
    constructor(
        readonly violation: PTPProtocolViolation,
        message: string,
        context: PTPErrorContext = {}
    ) {
        super(message, context)
        this.name = 'PTPProtocolError'
    }
}

/** A dataset arrived intact at the container level but could not be decoded. */
export class PTPDecodeError extends PTPError {
    constructor(message: string, context: PTPErrorContext = {}) {
        super(message, context)
        this.name = 'PTPDecodeError'
    }
}

/** The camera answered a transaction with a response code the caller cannot continue from. */
export class PTPResponseError extends PTPError {
    constructor(
        readonly code: number,
        message = `camera answered 0x${code.toString(16).padStart(4, '0')}`,
        context: PTPErrorContext = {}
    ) {
        super(message, context)
        this.name = 'PTPResponseError'
    }
}

/** The transport is gone (cable pulled, camera powered off, socket closed). Reconnect to continue. */
export class PTPDisconnectedError extends PTPError {
    constructor(message: string, context: PTPErrorContext = {}) {
        super(message, context)
        this.name = 'PTPDisconnectedError'
    }
}
