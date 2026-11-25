import { genericEventRegistry } from '@ptp/definitions/event-definitions'
import { formatRegistry } from '@ptp/definitions/format-definitions'
import { genericOperationRegistry } from '@ptp/definitions/operation-definitions'
import { genericPropertyRegistry } from '@ptp/definitions/property-definitions'
import { responseRegistry } from '@ptp/definitions/response-definitions'
import { canonEventRegistry } from '@vendors/canon/definitions/canon-event-definitions'
import { canonOperationRegistry } from '@vendors/canon/definitions/canon-operation-definitions'
import { canonPropertyRegistry } from '@vendors/canon/definitions/canon-property-definitions'
import { canonResponseRegistry } from '@vendors/canon/definitions/canon-response-definitions'
import { fujifilmOperationRegistry } from '@vendors/fujifilm/definitions/fujifilm-operation-definitions'
import { leicaOperationRegistry } from '@vendors/leica/definitions/leica-operation-definitions'
import { nikonEventRegistry } from '@vendors/nikon/definitions/nikon-event-definitions'
import { nikonOperationRegistry } from '@vendors/nikon/definitions/nikon-operation-definitions'
import { nikonPropertyRegistry } from '@vendors/nikon/definitions/nikon-property-definitions'
import { nikonResponseRegistry } from '@vendors/nikon/definitions/nikon-response-definitions'
import { olympusOperationRegistry } from '@vendors/olympus/definitions/olympus-operation-definitions'
import { panasonicOperationRegistry } from '@vendors/panasonic/definitions/panasonic-operation-definitions'
import { sigmaOperationRegistry } from '@vendors/sigma/definitions/sigma-operation-definitions'
import { sonyEventRegistry } from '@vendors/sony/definitions/sony-event-definitions'
import { sonyFormatRegistry } from '@vendors/sony/definitions/sony-format-definitions'
import { sonyOperationRegistry } from '@vendors/sony/definitions/sony-operation-definitions'
import { sonyPropertyRegistry } from '@vendors/sony/definitions/sony-property-definitions'
import { sonyResponseRegistry } from '@vendors/sony/definitions/sony-response-definitions'
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
    Override<typeof genericEventRegistry, typeof canonEventRegistry>,
    typeof formatRegistry,
    Override<typeof responseRegistry, typeof canonResponseRegistry>
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
        responses: { ...responseRegistry, ...canonResponseRegistry },
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
