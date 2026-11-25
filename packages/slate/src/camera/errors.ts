/**
 * The three ways a public Camera operation fails. Each carries the operation (a method name or a
 * setting id) so hosts can say which request failed without parsing the message.
 */

/** This camera cannot do it right now; `getCapabilities()` says why. Nothing was sent. */
export class CameraUnsupportedError extends Error {
    constructor(
        readonly operation: string,
        message: string
    ) {
        super(message)
        this.name = 'CameraUnsupportedError'
    }
}

/** The camera said no, or the value is not one it offers now. Nothing changed. */
export class CameraRefusedError extends Error {
    constructor(
        readonly operation: string,
        message: string
    ) {
        super(message)
        this.name = 'CameraRefusedError'
    }
}

/**
 * The command was sent but its result could not be confirmed. It is never resent, so a photo,
 * a stop or a setting write is never repeated by accident; read the camera again before retrying.
 */
export class CameraOutcomeUnknownError extends Error {
    constructor(
        readonly operation: string,
        message: string
    ) {
        super(message)
        this.name = 'CameraOutcomeUnknownError'
    }
}

/**
 * The camera confirmed it stopped recording, but no new finished clip appeared on the card in time.
 * Stop is not resent; any footage stays on the card, where listing the card finds it later.
 */
export class CameraClipNotFoundError extends CameraOutcomeUnknownError {
    constructor(operation: string, message: string) {
        super(operation, message)
        this.name = 'CameraClipNotFoundError'
    }
}
