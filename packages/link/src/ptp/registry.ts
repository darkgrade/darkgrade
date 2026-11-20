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
import { nikonEventRegistry } from '@ptp/definitions/vendors/nikon/nikon-event-definitions'
import { nikonOperationRegistry } from '@ptp/definitions/vendors/nikon/nikon-operation-definitions'
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
import { createBaseCodecs, type BaseCodecRegistry } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import { fujifilmPropertyRegistry } from '@vendors/fujifilm/properties'

// Name the shared shapes once: inferred spread returns duplicated every definition in .d.ts.
// Omit preserves the runtime spread's last-definition-wins semantics without widening codecs.
type Override<Standard, Vendor> = Omit<Standard, keyof Vendor> & Vendor

export type PTPRegistry = {
    readonly codecs: BaseCodecRegistry
    readonly operations: typeof genericOperationRegistry
    readonly properties: typeof genericPropertyRegistry
    readonly events: typeof genericEventRegistry
    readonly formats: typeof formatRegistry
    readonly responses: typeof responseRegistry
}

type ExtendedRegistry<
    Operations,
    Properties = typeof genericPropertyRegistry,
    Events = typeof genericEventRegistry,
    Formats = typeof formatRegistry,
    Responses = typeof responseRegistry,
> = {
    readonly codecs: BaseCodecRegistry
    readonly operations: Override<typeof genericOperationRegistry, Operations>
    readonly properties: Properties
    readonly events: Events
    readonly formats: Formats
    readonly responses: Responses
}

export type SonyRegistry = ExtendedRegistry<
    typeof sonyOperationRegistry,
    Override<typeof genericPropertyRegistry, typeof sonyPropertyRegistry>,
    Override<typeof genericEventRegistry, typeof sonyEventRegistry>,
    Override<typeof formatRegistry, typeof sonyFormatRegistry>,
    Override<typeof responseRegistry, typeof sonyResponseRegistry>
>
export type NikonRegistry = ExtendedRegistry<
    typeof nikonOperationRegistry,
    Override<typeof genericPropertyRegistry, typeof nikonPropertyRegistry>,
    Override<typeof genericEventRegistry, typeof nikonEventRegistry>,
    typeof formatRegistry,
    Override<typeof responseRegistry, typeof nikonResponseRegistry>
>
export type CanonRegistry = ExtendedRegistry<
    typeof canonOperationRegistry,
    Override<typeof genericPropertyRegistry, typeof canonPropertyRegistry>,
    Override<typeof genericEventRegistry, typeof canonEventRegistry>
>
type FujifilmRegistry = ExtendedRegistry<
    typeof fujifilmOperationRegistry,
    Override<typeof genericPropertyRegistry, typeof fujifilmPropertyRegistry>
>

export const createPTPRegistry = (littleEndian: boolean): PTPRegistry =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: genericOperationRegistry,
        properties: genericPropertyRegistry,
        events: genericEventRegistry,
        formats: formatRegistry,
        responses: responseRegistry,
    }) as const

export const createSonyRegistry = (littleEndian: boolean): SonyRegistry =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...sonyOperationRegistry },
        properties: { ...genericPropertyRegistry, ...sonyPropertyRegistry },
        events: { ...genericEventRegistry, ...sonyEventRegistry },
        formats: { ...formatRegistry, ...sonyFormatRegistry },
        responses: { ...responseRegistry, ...sonyResponseRegistry },
    }) as const

export const createNikonRegistry = (littleEndian: boolean): NikonRegistry =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...nikonOperationRegistry },
        properties: { ...genericPropertyRegistry, ...nikonPropertyRegistry },
        events: { ...genericEventRegistry, ...nikonEventRegistry },
        formats: formatRegistry,
        responses: { ...responseRegistry, ...nikonResponseRegistry },
    }) as const

export const createCanonRegistry = (littleEndian: boolean): CanonRegistry =>
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
): ExtendedRegistry<Operations> =>
    ({
        codecs: createBaseCodecs(littleEndian),
        operations: { ...genericOperationRegistry, ...operations },
        properties: genericPropertyRegistry,
        events: genericEventRegistry,
        formats: formatRegistry,
        responses: responseRegistry,
    }) as const

export const createFujifilmRegistry = (littleEndian: boolean): FujifilmRegistry =>
    ({
        ...createVendorOperationRegistry(littleEndian, fujifilmOperationRegistry),
        properties: { ...genericPropertyRegistry, ...fujifilmPropertyRegistry },
    }) as const
export const createPanasonicRegistry = (littleEndian: boolean): ExtendedRegistry<typeof panasonicOperationRegistry> =>
    createVendorOperationRegistry(littleEndian, panasonicOperationRegistry)
export const createOlympusRegistry = (littleEndian: boolean): ExtendedRegistry<typeof olympusOperationRegistry> =>
    createVendorOperationRegistry(littleEndian, olympusOperationRegistry)
export const createLeicaRegistry = (littleEndian: boolean): ExtendedRegistry<typeof leicaOperationRegistry> =>
    createVendorOperationRegistry(littleEndian, leicaOperationRegistry)
export const createSigmaRegistry = (littleEndian: boolean): ExtendedRegistry<typeof sigmaOperationRegistry> =>
    createVendorOperationRegistry(littleEndian, sigmaOperationRegistry)

export type VendorOperationRegistry =
    | ReturnType<typeof createFujifilmRegistry>
    | ReturnType<typeof createPanasonicRegistry>
    | ReturnType<typeof createOlympusRegistry>
    | ReturnType<typeof createLeicaRegistry>
    | ReturnType<typeof createSigmaRegistry>

export type Registry = PTPRegistry | SonyRegistry | NikonRegistry | CanonRegistry | VendorOperationRegistry
