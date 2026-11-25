import type { PropertyDefinition } from '@ptp/types/property'

/** A canonical control's properties in preference order: the first one the camera advertises wins. */
export type ControlPropertyList = readonly PropertyDefinition[]

export type ControlPropertyMap<Ids extends string = string> = { readonly [Id in Ids]?: ControlPropertyList }

/** One settings group's properties for each property inventory Slate reads. */
export interface VendorControlProperties<Ids extends string> {
    sony: ControlPropertyMap<Ids>
    canon: ControlPropertyMap<Ids>
    /** Standard PTP properties, for bodies without a vendor adapter. */
    standard: ControlPropertyMap<Ids>
    /** Nikon in photo mode (LiveViewSelector PHOTO). */
    nikonPhoto: ControlPropertyMap<Ids>
    /** Nikon in movie mode (LiveViewSelector VIDEO). */
    nikonMovie: ControlPropertyMap<Ids>
}

/**
 * How one setting's vendor words map to its canonical names. `canonical` returns undefined for a
 * word Slate has no name for; such a choice is never offered or written.
 */
export interface ControlValueVocabulary {
    canonical(label: string): string | undefined
    /**
     * Groups choices that belong together (Sony's movie exposure modes are a family apart from its
     * photo modes); only the current value's family is offered.
     */
    family?(label: string): string
    /**
     * Canonical names that are read but never offered as a choice, because the vendor codec gives
     * several codes that one word (Canon's 0x0000, 0xffff and 0x00b0 apertures are all `auto`) and a
     * write by that word could send a code the camera did not advertise.
     */
    readOnly?: readonly string[]
}

/** Where a value vocabulary applies: each property inventory, plus the Sony Camera Remote SDK session. */
export type ControlValueInventory = keyof VendorControlProperties<string> | 'sonySdk'

/** One settings group's value vocabularies for each inventory. */
export type VendorControlValues<Ids extends string> = {
    [Inventory in ControlValueInventory]: { readonly [Id in Ids]?: ControlValueVocabulary }
}
