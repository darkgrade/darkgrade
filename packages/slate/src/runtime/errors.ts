/** How a busy camera is reported over HTTP: the status and code a runtime host sends and a client reads. */
export const HARDWARE_BUSY = { status: 409, code: 'HARDWARE_BUSY' } as const

export class HardwareBusyError extends Error {
    readonly status = HARDWARE_BUSY.status
    readonly code = HARDWARE_BUSY.code
    readonly retryAfterMilliseconds = 1000
}
