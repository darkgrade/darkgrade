export class HardwareBusyError extends Error {
    readonly status = 409
    readonly code = 'HARDWARE_BUSY'
    readonly retryAfterMilliseconds = 1000
}
