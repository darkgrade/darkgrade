import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import { formatRegistry } from '@ptp/definitions/format-definitions'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { responseRegistry } from '@ptp/definitions/response-definitions'
import { canonEventRegistry } from '@ptp/definitions/vendors/canon/canon-event-definitions'
import { canonOperationRegistry } from '@ptp/definitions/vendors/canon/canon-operation-definitions'
import { canonPropertyRegistry } from '@ptp/definitions/vendors/canon/canon-property-definitions'
import { fujifilmOperationRegistry } from '@ptp/definitions/vendors/fujifilm/fujifilm-operation-definitions'
import { leicaOperationRegistry } from '@ptp/definitions/vendors/leica/leica-operation-definitions'
import { nikonOperationRegistry } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
import { nikonEventRegistry } from '@ptp/definitions/vendors/nikon/nikon-event-definitions'
import { nikonPropertyRegistry } from '@ptp/definitions/vendors/nikon/nikon-property-definitions'
import { nikonResponseRegistry } from '@ptp/definitions/vendors/nikon/nikon-response-definitions'
import { olympusOperationRegistry } from '@ptp/definitions/vendors/olympus/olympus-operation-definitions'
import { panasonicOperationRegistry } from '@ptp/definitions/vendors/panasonic/panasonic-operation-definitions'
import { sigmaOperationRegistry } from '@ptp/definitions/vendors/sigma/sigma-operation-definitions'
import { sonyEventRegistry } from '@ptp/definitions/vendors/sony/sony-event-definitions'
import { sonyFormatRegistry } from '@ptp/definitions/vendors/sony/sony-format-definitions'
import { sonyOperationRegistry } from '@ptp/definitions/vendors/sony/sony-operation-definitions'
import { sonyPropertyRegistry } from '@ptp/definitions/vendors/sony/sony-property-definitions'
import { sonyResponseRegistry } from '@ptp/definitions/vendors/sony/sony-response-definitions'
import { createBaseCodecs } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import { fujifilmPropertyRegistry } from '@vendors/fujifilm/properties'

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
        events: { ...genericEventRegistry, ...nikonEventRegistry },
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

/**
 * A registry that adds only vendor operations to the standard definitions. Used for vendors whose
 * darkgrade support is limited to cited operation definitions (no vendor properties or events yet).
 */
const createVendorOperationRegistry = <Operations extends Record<string, OperationDefinition>>(
    littleEndian: boolean,
    operations: Operations
) =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...operations },
        properties: genericPropertyRegistry,
        events: genericEventRegistry,
        formats: formatRegistry,
        responses: responseRegistry,
    }) as const

export const createFujifilmRegistry = (littleEndian: boolean) =>
    ({
        ...createVendorOperationRegistry(littleEndian, fujifilmOperationRegistry),
        properties: { ...genericPropertyRegistry, ...fujifilmPropertyRegistry },
    }) as const
export const createPanasonicRegistry = (littleEndian: boolean) =>
    createVendorOperationRegistry(littleEndian, panasonicOperationRegistry)
export const createOlympusRegistry = (littleEndian: boolean) =>
    createVendorOperationRegistry(littleEndian, olympusOperationRegistry)
export const createLeicaRegistry = (littleEndian: boolean) =>
    createVendorOperationRegistry(littleEndian, leicaOperationRegistry)
export const createSigmaRegistry = (littleEndian: boolean) =>
    createVendorOperationRegistry(littleEndian, sigmaOperationRegistry)

export type PTPRegistry = ReturnType<typeof createPTPRegistry>
export type SonyRegistry = ReturnType<typeof createSonyRegistry>
export type NikonRegistry = ReturnType<typeof createNikonRegistry>
export type CanonRegistry = ReturnType<typeof createCanonRegistry>

export type VendorOperationRegistry =
    | ReturnType<typeof createFujifilmRegistry>
    | ReturnType<typeof createPanasonicRegistry>
    | ReturnType<typeof createOlympusRegistry>
    | ReturnType<typeof createLeicaRegistry>
    | ReturnType<typeof createSigmaRegistry>

export type Registry = PTPRegistry | SonyRegistry | NikonRegistry | CanonRegistry | VendorOperationRegistry
