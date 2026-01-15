import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import { formatRegistry } from '@ptp/definitions/format-definitions'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { responseRegistry } from '@ptp/definitions/response-definitions'
import { canonEventRegistry } from '@ptp/definitions/vendors/canon/canon-event-definitions'
import { canonOperationRegistry } from '@ptp/definitions/vendors/canon/canon-operation-definitions'
import { canonPropertyRegistry } from '@ptp/definitions/vendors/canon/canon-property-definitions'
import { nikonOperationRegistry } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { nikonPropertyRegistry } from '@ptp/definitions/vendors/nikon/nikon-property-definitions'
import { nikonResponseRegistry } from '@ptp/definitions/vendors/nikon/nikon-response-definitions'
import { sonyEventRegistry } from '@ptp/definitions/vendors/sony/sony-event-definitions'
import { sonyFormatRegistry } from '@ptp/definitions/vendors/sony/sony-format-definitions'
import { sonyOperationRegistry } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { sonyPropertyRegistry } from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { sonyResponseRegistry } from '@ptp/definitions/vendors/sony/sony-response-definitions'
import { createBaseCodecs } from '@ptp/types/codec'

export const createPTPRegistry = (littleEndian: boolean) =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: genericOperationRegistry,
        properties: genericPropertyRegistry,
        events: genericEventRegistry,
        formats: formatRegistry,
        responses: responseRegistry,
    }) as const

export const createSonyRegistry = (littleEndian: boolean) =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...sonyOperationRegistry },
        properties: { ...genericPropertyRegistry, ...sonyPropertyRegistry },
        events: { ...genericEventRegistry, ...sonyEventRegistry },
        formats: { ...formatRegistry, ...sonyFormatRegistry },
        responses: { ...responseRegistry, ...sonyResponseRegistry },
    }) as const

export const createNikonRegistry = (littleEndian: boolean) =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...nikonOperationRegistry },
        properties: { ...genericPropertyRegistry, ...nikonPropertyRegistry },
        events: genericEventRegistry,
        formats: formatRegistry,
        responses: { ...responseRegistry, ...nikonResponseRegistry },
    }) as const

export const createCanonRegistry = (littleEndian: boolean) =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...canonOperationRegistry },
        properties: { ...genericPropertyRegistry, ...canonPropertyRegistry },
        events: { ...genericEventRegistry, ...canonEventRegistry },
        formats: formatRegistry,
        responses: responseRegistry,
    }) as const

export type PTPRegistry = ReturnType<typeof createPTPRegistry>
export type SonyRegistry = ReturnType<typeof createSonyRegistry>
export type NikonRegistry = ReturnType<typeof createNikonRegistry>
export type CanonRegistry = ReturnType<typeof createCanonRegistry>

export type Registry = PTPRegistry | SonyRegistry | NikonRegistry | CanonRegistry
