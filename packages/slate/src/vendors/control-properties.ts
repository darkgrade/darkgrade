import type { CameraControlId, UnrecognizedValues } from '@camera/controls'
import { EnumCodec, type CodecType } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import {
    canonControlProperties,
    canonControlValueNames,
    canonControlValues,
} from '@vendors/canon/control-properties'
import {
    standardControlProperties,
    standardControlValueNames,
    standardControlValues,
} from '@vendors/generic/control-properties'
import {
    nikonControlValues,
    nikonMovieControlProperties,
    nikonMovieControlValueNames,
    nikonPhotoControlProperties,
    nikonPhotoControlValueNames,
} from '@vendors/nikon/control-properties'
import { createPTPRegistry } from '@vendors/registry'
import {
    sonyControlProperties,
    sonyControlValueNames,
    sonyControlValues,
    sonySdkControlValues,
} from '@vendors/sony/control-properties'


/** A canonical control's properties in preference order: the first one the camera advertises wins. */
export type ControlPropertyList = readonly PropertyDefinition[]

export type ControlPropertyMap<Ids extends string = CameraControlId> = { readonly [Id in Ids]?: ControlPropertyList }

/**
 * Each vendor's properties, one map per inventory in `@vendors/<vendor>/control-properties`.
 * Preference order is within one vendor and mode, never across vendors.
 */
const controlProperties = {
    sony: sonyControlProperties,
    canon: canonControlProperties,
    /** Standard PTP properties, for bodies without a vendor adapter. */
    standard: standardControlProperties,
    /** Nikon in photo mode (LiveViewSelector PHOTO). */
    nikonPhoto: nikonPhotoControlProperties,
    /** Nikon in movie mode (LiveViewSelector VIDEO). */
    nikonMovie: nikonMovieControlProperties,
} as const

/** The property inventories Slate reads: one per vendor adapter and, for Nikon, per photo/movie mode. */
export type ControlInventory = keyof typeof controlProperties

type PropertyFor<Id extends CameraControlId> = (typeof controlProperties)[ControlInventory] extends infer Map
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

type VideoSettingId = 'videoFormat' | 'videoQuality' | 'frameRate' | 'audioRecording'

const videoValueNames = new Map<VideoSettingId, ReadonlySet<string>>()

/**
 * The names a setting's enumerated vendor codecs decode, across every vendor: the runtime
 * counterpart of `CodecValue<id>`, so a reader can tell a named value from a label it never knew.
 */
export function videoCodecValueNames(id: VideoSettingId): ReadonlySet<string> {
    const known = videoValueNames.get(id)
    if (known) return known
    const registry = createPTPRegistry(true)
    const names = new Set<string>()
    const inventories: readonly ControlPropertyMap[] = Object.values(controlProperties)
    for (const inventory of inventories)
        for (const property of inventory[id] ?? []) {
            const codec = typeof property.codec === 'function' ? property.codec(registry) : property.codec
            if (codec instanceof EnumCodec) for (const value of codec.getAllValues()) names.add(String(value.name))
        }
    videoValueNames.set(id, names)
    return names
}

/**
 * How one setting's vendor words map to its canonical names. `canonical` returns undefined for a
 * word Slate has no name for; such a choice is never offered or written.
 */
export interface ControlValueVocabulary {
    /** `property` is the observed property's name, for vocabularies whose words differ per property. */
    canonical(label: string, property: string): string | undefined
    /**
     * The vendor words behind a canonical name on one property, for a write with no advertised
     * choice behind it. More than one word is ambiguous and refused.
     */
    vendorWords?(canonical: string, property: string): string[]
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
export type ControlValueInventory = ControlInventory | 'sonySdk'

/** One inventory's value vocabularies; a setting without one keeps the vendor's words. */
export type ControlValueTable = { readonly [Id in CameraControlId]?: ControlValueVocabulary }

/** For one setting: per property name, each vendor label and its canonical name. */
export type ControlPropertyValueNames = { readonly [PropertyName: string]: Readonly<Record<string, string>> }

/**
 * One inventory's canonical value names. A table lists only the settings whose vendor labels differ
 * from the canonical spelling; others keep the codec's label.
 */
export type ControlValueNameTable = { readonly [Id in CameraControlId]?: ControlPropertyValueNames }

/**
 * Canonical names for one property's codec values: every value the codec decodes must have one
 * (the compiler checks it against `CodecType`), so a codec change cannot leak a vendor's word.
 */
export type CanonicalValueNames<Property extends PropertyDefinition> = Readonly<
    Record<Extract<CodecType<Property['codec']>, string>, string>
>

const controlValueNameTables = {
    sony: sonyControlValueNames,
    canon: canonControlValueNames,
    standard: standardControlValueNames,
    nikonPhoto: nikonPhotoControlValueNames,
    nikonMovie: nikonMovieControlValueNames,
} as const

/** The canonical values a name table gives one setting, across every vendor. */
export type NamedControlValue<Id extends CameraControlId> = (typeof controlValueNameTables)[ControlInventory] extends infer Table
    ? Table extends { readonly [Key in Id]: infer Properties }
        ? { [Property in keyof Properties]: Properties[Property][keyof Properties[Property]] }[keyof Properties]
        : never
    : never

/** The canonical names of one setting's values on one inventory, per property; undefined when the labels are canonical. */
export function controlValueNames(inventory: ControlInventory, id: CameraControlId): ControlPropertyValueNames | undefined {
    const table: ControlValueNameTable = controlValueNameTables[inventory]
    return table[id]
}

/** Every canonical value a name table gives a setting, on any vendor. */
export function namedControlValues(id: CameraControlId): ReadonlySet<string> {
    const inventories = Object.keys(controlValueNameTables) as ControlInventory[]
    return new Set(
        inventories.flatMap(inventory =>
            Object.values(controlValueNames(inventory, id) ?? {}).flatMap(names => Object.values(names))
        )
    )
}

/**
 * A per-property name table as a vocabulary. A property without a table keeps the camera's own
 * labels; a word missing from its property's table has no canonical name, so it reads as
 * unrecognized and is never offered as a choice (a placeholder such as "Unknown focus (5)" is not a value).
 */
function nameTableVocabulary(names: ControlPropertyValueNames): ControlValueVocabulary {
    return {
        canonical: (label, property) => {
            const table = names[property]
            return table ? table[label] : label
        },
        vendorWords: (canonical, property) =>
            Object.entries(names[property] ?? {})
                .filter(([, name]) => name === canonical)
                .map(([label]) => label),
    }
}

/**
 * Each inventory's value vocabularies. Name tables and vocabulary functions are one mechanism:
 * each observation and write goes through it.
 */
const controlValueTables: { readonly [Inventory in ControlValueInventory]: ControlValueTable } = {
    sony: sonyControlValues,
    sonySdk: sonySdkControlValues,
    canon: canonControlValues,
    standard: standardControlValues,
    nikonPhoto: nikonControlValues,
    nikonMovie: nikonControlValues,
}

function controlValueVocabulary(inventory: ControlValueInventory, id: CameraControlId): ControlValueVocabulary | undefined {
    const vocabulary = controlValueTables[inventory][id]
    if (vocabulary || inventory === 'sonySdk') return vocabulary
    const names = controlValueNames(inventory, id)
    return names && nameTableVocabulary(names)
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
 * Maps a control's vendor words to canonical names, or returns undefined when the inventory keeps
 * the vendor's words for it. Choices with no canonical name, or from another family than the
 * current value (Sony movie modes while in photo mode), are not offered.
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
