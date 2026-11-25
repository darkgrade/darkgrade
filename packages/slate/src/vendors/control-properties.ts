import type { CameraControlId, UnrecognizedValues } from '@camera/controls'
import type { CodecType } from '@ptp/types/codec'
import { colourControlProperties } from '@vendors/control-properties/colour'
import { exposureControlProperties, exposureControlValues } from '@vendors/control-properties/exposure'
import { focusControlProperties, focusControlValueNames } from '@vendors/control-properties/focus'
import { liveViewValueNames } from '@camera/settings/live-view'
import { videoValueNames } from '@camera/settings/video'
import { liveViewControlProperties } from '@vendors/control-properties/live-view'
import { modeControlProperties } from '@vendors/control-properties/mode'
import { photoControlProperties } from '@vendors/control-properties/photo'
import { videoControlProperties } from '@vendors/control-properties/video'
import type {
    ControlPropertyMap,
    ControlPropertyValueNames,
    ControlValueInventory,
    ControlValueNames,
    ControlValueVocabulary,
    VendorControlProperties,
    VendorControlValues,
} from '@vendors/control-properties/vendor-control-properties'

export type {
    ControlPropertyList,
    ControlPropertyMap,
    ControlPropertyValueNames,
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

/** The property inventories Slate reads: one per vendor adapter and, for Nikon, per photo/movie mode. */
export type ControlInventory = keyof VendorControlProperties<CameraControlId>

const inventories: readonly ControlInventory[] = ['sony', 'canon', 'standard', 'nikonPhoto', 'nikonMovie']

/**
 * Each settings group's canonical value names (see `focusControlValueNames`); groups append theirs.
 * The video and live-view tables live with their browser-safe vocabularies and are Sony's.
 */
const valueNameGroups: readonly ControlValueNames<CameraControlId>[] = [
    focusControlValueNames,
    { sony: { digitalZoom: videoValueNames, liveViewQuality: liveViewValueNames } },
]

/** The canonical names of one setting's values on one inventory, per property; undefined when the labels are canonical. */
export function controlValueNames(inventory: ControlInventory, id: CameraControlId): ControlPropertyValueNames | undefined {
    const tables = valueNameGroups.flatMap(group => {
        const names = group[inventory]?.[id]
        return names ? [names] : []
    })
    return tables.length ? Object.assign({}, ...tables) : undefined
}

/** Every canonical value a name table gives a setting, on any vendor. */
export function namedControlValues(id: CameraControlId): ReadonlySet<string> {
    return new Set(
        inventories.flatMap(inventory =>
            Object.values(controlValueNames(inventory, id) ?? {}).flatMap(names => Object.values(names))
        )
    )
}

/**
 * A per-property name table as a vocabulary. A word missing from the table keeps the camera's own
 * label, as the table's group documents; the typed getters refuse to name it.
 */
function nameTableVocabulary(names: ControlPropertyValueNames): ControlValueVocabulary {
    return {
        canonical: (label, property) => names[property]?.[label] ?? label,
        vendorWords: (canonical, property) =>
            Object.entries(names[property] ?? {})
                .filter(([, name]) => name === canonical)
                .map(([label]) => label),
    }
}

function nameTableValues(group: ControlValueNames<CameraControlId>): VendorControlValues<CameraControlId> {
    const vocabularies = (inventory: ControlInventory) =>
        Object.fromEntries(
            Object.entries(group[inventory] ?? {}).flatMap(([id, names]) => (names ? [[id, nameTableVocabulary(names)]] : []))
        )
    return {
        sony: vocabularies('sony'),
        canon: vocabularies('canon'),
        standard: vocabularies('standard'),
        nikonPhoto: vocabularies('nikonPhoto'),
        nikonMovie: vocabularies('nikonMovie'),
        sonySdk: {},
    }
}

/**
 * Every settings group's value vocabularies; a group without one keeps the vendor's words. Name
 * tables and vocabulary functions are one mechanism: each observation and write goes through it.
 */
const valueGroups: readonly VendorControlValues<CameraControlId>[] = [
    exposureControlValues,
    ...valueNameGroups.map(nameTableValues),
]

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
    allowedValues?: readonly string[],
    property = ''
): CanonicalControlValues | undefined {
    const vocabulary = controlValueVocabulary(inventory, id)
    if (!vocabulary) return undefined
    const current = vocabulary.canonical(value, property)
    const family = vocabulary.family?.(value)
    const vendorIndex = new Map<string, number>()
    const offered: string[] = []
    const unnamed: string[] = []
    allowedValues?.forEach((choice, index) => {
        if (family !== undefined && vocabulary.family?.(choice) !== family) return
        const canonical = vocabulary.canonical(choice, property)
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

/**
 * The single vendor word behind a canonical name on one property, for a write with no advertised
 * choice behind it; undefined when the vocabulary cannot say. Several words are ambiguous: refused.
 */
export function vendorControlWord(
    inventory: ControlValueInventory,
    id: CameraControlId,
    property: string,
    canonical: string
): { word: string } | { ambiguous: string[] } | undefined {
    const words = controlValueVocabulary(inventory, id)?.vendorWords?.(canonical, property) ?? []
    if (words.length > 1) return { ambiguous: words }
    return words.length === 1 ? { word: words[0]! } : undefined
}
