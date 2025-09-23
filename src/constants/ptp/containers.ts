/**
 * PTP Container Types and Protocol Constants
 * Standard sizes, limits, and container definitions for PTP protocol
 */

import { MessageType } from '@constants/types'

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
 * Map container type to message type
 * @param containerType - PTP container type value
 * @returns Corresponding MessageType enum value
 */
export function containerTypeToMessageType(containerType: number): MessageType {
  switch (containerType) {
    case ContainerTypes.COMMAND_BLOCK:
      return MessageType.COMMAND
    case ContainerTypes.DATA_BLOCK:
      return MessageType.DATA
    case ContainerTypes.RESPONSE_BLOCK:
      return MessageType.RESPONSE
    case ContainerTypes.EVENT_BLOCK:
      return MessageType.EVENT
    default:
      throw new Error(`Unknown container type: 0x${containerType.toString(16)}`)
  }
}

/**
 * PTP Container structure sizes
 */
export const PTP_CONTAINER = {
  /** Standard PTP container header size (length + type + code + transaction ID) */
  HEADER_SIZE: 12,
  /** Maximum parameters in a command container (5 * 4 bytes) */
  MAX_PARAM_BYTES: 20,
  /** Maximum parameters count */
  MAX_PARAMS: 5,
  /** Size of each parameter in bytes */
  PARAM_SIZE: 4,
} as const

/**
 * PTP Transaction limits
 */
export const PTP_LIMITS = {
  /** Maximum transaction ID before rollover */
  MAX_TRANSACTION_ID: 0xffffffff,
  /** Default receive buffer size */
  DEFAULT_RECEIVE_SIZE: 512,
  /** Default data receive size (64KB) */
  DEFAULT_DATA_SIZE: 65536,
} as const

/**
 * USB-specific limits
 */
export const USB_LIMITS = {
  /** Maximum WebUSB transfer size (32MB - 1KB for safety) */
  MAX_WEBUSB_TRANSFER: 32 * 1024 * 1024 - 1024,
  /** Default USB receive timeout in milliseconds */
  RECEIVE_TIMEOUT: 5000,
  /** Default bulk transfer size */
  DEFAULT_BULK_SIZE: 8192,
} as const

/**
 * Event container limits
 */
export const EVENT_LIMITS = {
  /** Maximum event parameters (typically 3) */
  MAX_PARAMS: 3,
  /** Maximum event parameter bytes (3 * 4 bytes) */
  MAX_PARAM_BYTES: 12,
} as const