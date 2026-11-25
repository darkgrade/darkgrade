import type { CameraControlId, UnrecognizedValues } from '@camera/controls'
import type { CodecType } from '@ptp/types/codec'
import { colourControlProperties } from '@vendors/control-properties/colour'
import { exposureControlProperties, exposureControlValues } from '@vendors/control-properties/exposure'
import { focusControlProperties } from '@vendors/control-properties/focus'
import { liveViewControlProperties } from '@vendors/control-properties/live-view'
import { modeControlProperties } from '@vendors/control-properties/mode'
import { photoControlProperties } from '@vendors/control-properties/photo'
import { videoControlProperties } from '@vendors/control-properties/video'
import type {
    ControlPropertyMap,
    ControlValueInventory,
    ControlValueVocabulary,
    VendorControlValues,
} from '@vendors/control-properties/vendor-control-properties'

export type {
    ControlPropertyList,
    ControlPropertyMap,
    ControlValueInventory,
} from '@vendors/control-properties/vendor-control-properties'

/**
 * Every settings group's vendor properties, one file per group under
 * `@vendors/control-properties/`. Preference order is within one vendor and mode, never across vendors.
 */
const groups = [
    exposureControlProperties,
    modeControlProperties,
    colourControlProperties,
    focusControlProperties,
    photoControlProperties,
    videoControlProperties,
    liveViewControlProperties,
] as const

type Groups = (typeof groups)[number]
type Inventory = keyof Groups
type Combined<Name extends Inventory> = UnionToIntersection<Groups[Name]>
type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
    value: infer Intersection
) => void
    ? Intersection
    : never

function combine<Name extends Inventory>(name: Name): Combined<Name> & ControlPropertyMap<CameraControlId> {
    return Object.assign({}, ...groups.map(group => group[name]))
}

export const sonyControlProperties = combine('sony')
export const canonControlProperties = combine('canon')
export const standardControlProperties = combine('standard')
export const nikonPhotoControlProperties = combine('nikonPhoto')
export const nikonMovieControlProperties = combine('nikonMovie')

type PropertyFor<Id extends CameraControlId> = Groups[Inventory] extends infer Map
    ? Map extends { readonly [Key in Id]: readonly (infer Property)[] }
        ? Property
        : never
    : never

/**
 * The value a setting's vendor codecs decode, across every vendor: the union of
 * `CodecType<property.codec>` for each property mapped to `Id`. An enumerated property contributes
 * its literal names; a free-form codec contributes `string`, which a typed setting must replace with
 * a canonical type (as `ShutterSpeed` does) before it gets a typed accessor.
 */
export type CodecValue<Id extends CameraControlId> = PropertyFor<Id> extends infer Property
    ? Property extends { codec: infer Codec }
        ? CodecType<Codec>
        : never
    : never

/** Every settings group's value vocabularies; a group without one keeps the vendor's words. */
const valueGroups: readonly VendorControlValues<CameraControlId>[] = [exposureControlValues]

function controlValueVocabulary(inventory: ControlValueInventory, id: CameraControlId): ControlValueVocabulary | undefined {
    return valueGroups.map(group => group[inventory][id]).find(Boolean)
}

/** Whether a setting's vendor words are mapped to canonical names on this inventory. */
export function hasCanonicalControlValues(inventory: ControlValueInventory, id: CameraControlId): boolean {
    return controlValueVocabulary(inventory, id) !== undefined
}

/** One control's observation in canonical names, and the vendor choice behind each name. */
export interface CanonicalControlValues {
    /** The canonical value, or `Unrecognized (<vendor word>)` when Slate has no name for it. */
    value: string
    allowedValues?: string[]
    /** Index into the vendor's own choice list for each offered canonical name. */
    vendorIndex: Map<string, number>
    /** The vendor words left out because they have no canonical name. */
    unrecognized?: UnrecognizedValues
}

/**
 * Maps a control's vendor words to canonical names, or returns undefined when its settings group
 * keeps the vendor's words. Choices with no canonical name, or from another family than the current
 * value (Sony movie modes while in photo mode), are not offered.
 */
export function canonicalControlValues(
    inventory: ControlValueInventory,
    id: CameraControlId,
    value: string,
    allowedValues?: readonly string[]
): CanonicalControlValues | undefined {
    const vocabulary = controlValueVocabulary(inventory, id)
    if (!vocabulary) return undefined
    const current = vocabulary.canonical(value)
    const family = vocabulary.family?.(value)
    const vendorIndex = new Map<string, number>()
    const offered: string[] = []
    const unnamed: string[] = []
    allowedValues?.forEach((choice, index) => {
        if (family !== undefined && vocabulary.family?.(choice) !== family) return
        const canonical = vocabulary.canonical(choice)
        if (canonical === undefined) {
            unnamed.push(choice)
            return
        }
        if (vocabulary.readOnly?.includes(canonical)) return
        offered.push(canonical)
        if (!vendorIndex.has(canonical)) vendorIndex.set(canonical, index)
    })
    const unrecognized: UnrecognizedValues = {
        ...(current === undefined ? { value } : {}),
        ...(unnamed.length ? { choices: unnamed } : {}),
    }
    return {
        value: current ?? `Unrecognized (${value})`,
        ...(allowedValues ? { allowedValues: offered } : {}),
        vendorIndex,
        ...(Object.keys(unrecognized).length ? { unrecognized } : {}),
    }
}
