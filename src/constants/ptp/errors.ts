/**
 * Error classes for PTP protocol and camera operations
 */

/**
 * PTP Error class for protocol errors
 */
export class PTPError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly operation?: string
  ) {
    super(message)
    this.name = 'PTPError'
  }
}