import { createBaseCodecs } from '@ptp/types/codec'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import { formatRegistry } from '@ptp/definitions/format-definitions'
import { responseRegistry } from '@ptp/definitions/response-definitions'
import { sonyOperationRegistry } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { sonyPropertyRegistry } from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { sonyEventRegistry } from '@ptp/definitions/vendors/sony/sony-event-definitions'
import { sonyFormatRegistry } from '@ptp/definitions/vendors/sony/sony-format-definitions'
import { sonyResponseRegistry } from '@ptp/definitions/vendors/sony/sony-response-definitions'
import { nikonOperationRegistry } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'

/**
 * Create unified PTP registry containing all codecs and definitions
 * Generic registry for standard PTP implementation
 */
export const createPTPRegistry = (littleEndian: boolean) => ({
    codecs: createBaseCodecs(littleEndian),
    operations: genericOperationRegistry,
    properties: genericPropertyRegistry,
    events: genericEventRegistry,
    formats: formatRegistry,
    responses: responseRegistry,
} as const)

/**
 * Create Sony-specific registry with vendor extensions
 */
export const createSonyRegistry = (littleEndian: boolean) => ({
    codecs: createBaseCodecs(littleEndian),
    operations: { ...genericOperationRegistry, ...sonyOperationRegistry },
    properties: { ...genericPropertyRegistry, ...sonyPropertyRegistry },
    events: { ...genericEventRegistry, ...sonyEventRegistry },
    formats: { ...formatRegistry, ...sonyFormatRegistry },
    responses: { ...responseRegistry, ...sonyResponseRegistry },
} as const)

/**
 * Create Nikon-specific registry with vendor extensions
 */
export const createNikonRegistry = (littleEndian: boolean) => ({
    codecs: createBaseCodecs(littleEndian),
    operations: { ...genericOperationRegistry, ...nikonOperationRegistry },
    properties: genericPropertyRegistry,
    events: genericEventRegistry,
    formats: formatRegistry,
    responses: responseRegistry,
} as const)

export type PTPRegistry = ReturnType<typeof createPTPRegistry>
export type SonyRegistry = ReturnType<typeof createSonyRegistry>
export type NikonRegistry = ReturnType<typeof createNikonRegistry>

export type Registry = PTPRegistry | SonyRegistry | NikonRegistry