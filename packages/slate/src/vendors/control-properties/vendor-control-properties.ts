import type { CodecType } from '@ptp/types/codec'
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
 * Canonical names for one property's codec values: every value the codec decodes must have one
 * (the compiler checks it against `CodecType`), so a codec change cannot leak a vendor's word.
 */
export type CanonicalValueNames<Property extends PropertyDefinition> = Readonly<
    Record<Extract<CodecType<Property['codec']>, string>, string>
>

/** Canonical value names keyed by vendor property name. A property without an entry keeps its codec's words. */
export type ControlValueNames = Readonly<Record<string, Readonly<Record<string, string>>>>
