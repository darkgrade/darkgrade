/**
 * PTP Container Types and Error class
 * V7 Architecture - Type-safe with validation
 */

/**
 * Container Types (PTP Protocol Section 9.3.1)
 */
export const ContainerTypes = {
  COMMAND_BLOCK: 0x0001,
  DATA_BLOCK: 0x0002,
  RESPONSE_BLOCK: 0x0003,
  EVENT_BLOCK: 0x0004,
} as const

export type ContainerType = typeof ContainerTypes[keyof typeof ContainerTypes]

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