import type { CameraControlId } from '@camera/controls'
import type { CodecType } from '@ptp/types/codec'
import { colourControlProperties } from '@vendors/control-properties/colour'
import { exposureControlProperties } from '@vendors/control-properties/exposure'
import { focusControlProperties } from '@vendors/control-properties/focus'
import { liveViewControlProperties } from '@vendors/control-properties/live-view'
import { modeControlProperties } from '@vendors/control-properties/mode'
import { photoControlProperties } from '@vendors/control-properties/photo'
import { videoControlProperties } from '@vendors/control-properties/video'
import type { ControlPropertyMap } from '@vendors/control-properties/vendor-control-properties'

export type { ControlPropertyList, ControlPropertyMap } from '@vendors/control-properties/vendor-control-properties'

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
