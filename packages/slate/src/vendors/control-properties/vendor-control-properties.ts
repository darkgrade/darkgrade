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
