import type { CameraCapabilities, CameraControlId, CameraControlState, CameraLens, UnrecognizedValues } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import { PTPDecodeError, PTPResponseError } from '@core/ptp-errors'
import type { DeviceInfo } from '@ptp/datasets/device-info-dataset'
import type { PropertyDefinition } from '@ptp/types/property'
import type { ControlPropertyMap, ControlValueInventory } from '@vendors/control-properties'
import { standardControlProperties } from '@vendors/generic/control-properties'
import type { GenericCamera, StandardPropertyState } from '@vendors/generic/generic-camera'
import { standardLens } from '@vendors/lens-information'

/*
 * What a driver's controls() hooks share: the observed property states a driver hands the shared
 * capability builder, and the write it is asked to send. Nothing here imports a driver class.
 */

export interface PropertyState {
    code: number
    name: string
    value: string | number | bigint
    allowedValues?: (string | number | bigint)[]
    writable: boolean
    enabled?: boolean
    range?: CameraControlState['range']
    unrecognized?: UnrecognizedValues
}

/** One driver observation of its controls, before canonical naming. */
export interface ControlObservation {
    states: PropertyState[]
    mappings: ControlPropertyMap<CameraControlId>
    /** Which vocabulary the observation is named with. */
    inventory: ControlValueInventory
    /** Controls composed from more than one observation (see `@vendors/photo-video-mode`). */
    composed?: CameraCapabilities['controls']
    /** The lens, from the same observation as the controls. */
    lens?: CameraLens
    /** The DeviceInfo the driver read for this observation, when the caller did not supply one. */
    deviceInfo?: DeviceInfo
    /** The vendor's display word for a value; the value itself when absent. */
    label?: (propertyName: string, value: string | number | bigint) => string
    /** Numeric shutter properties whose value is an exact exposure (Nikon's shutter and angle). */
    exactExposure?: readonly string[]
}

/** The camera's own choice behind a canonical name: its display word and the value it decodes to. */
export interface VendorChoice {
    label: string
    raw: string | number | bigint
}

/** One admitted control write: the observed state, Slate's requested spelling and the vendor's choice. */
export interface ControlWrite {
    id: CameraControlId
    state: CameraControlState
    requested: string
    vendorLabel: string
    vendorChoice?: VendorChoice
}

export const scalar = (value: unknown): value is string | number | bigint =>
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'bigint'

/**
 * Ranged properties whose canonical spelling is an exact number on the property's own wire scale:
 * `ISO 800` is 800, `f/2.8` is 280 hundredths. Only these keep a range behind a canonical name, so a
 * ranged write is never rounded; any other ranged canonical control stays read-only.
 */
const canonicalRanges: Readonly<Record<string, { id: CameraControlId; pattern: RegExp; wirePerUnit: number }>> = {
    ExposureIndex: { id: 'iso', pattern: /^ISO (\d+)$/, wirePerUnit: 1 },
    NikonMovieISO: { id: 'iso', pattern: /^ISO (\d+)$/, wirePerUnit: 1 },
    FNumber: { id: 'aperture', pattern: /^f\/(\d+(?:\.\d+)?)$/, wirePerUnit: 100 },
    NikonMovieFNumber: { id: 'aperture', pattern: /^f\/(\d+(?:\.\d+)?)$/, wirePerUnit: 100 },
}

export function propertyWithCode(driver: GenericCamera, code: number): PropertyDefinition | undefined {
    return Object.values(driver.registry.properties).find(property => property.code === code)
}

export function canonicalRange(id: CameraControlId, propertyName: string) {
    const range = canonicalRanges[propertyName]
    return range?.id === id ? range : undefined
}

/** The wire number a canonical name stands for on a ranged property, when it is exact. */
export function canonicalRangeWireValue(id: CameraControlId, propertyName: string, value: string): number | undefined {
    const range = canonicalRange(id, propertyName)
    const match = range?.pattern.exec(value)
    if (!range || !match) return undefined
    const wire = Number(match[1]) * range.wirePerUnit
    const rounded = Math.round(wire)
    return Math.abs(wire - rounded) < 1e-9 ? rounded : undefined
}

/**
 * A range on the property's wire scale. String codecs decode the limits as labels (`ISO 100`,
 * `f/2.8`); those are read back to wire numbers only for the exact canonical ranges above.
 */
export function wireRange(
    propertyName: string,
    limits: readonly (number | bigint | string | undefined)[]
): CameraControlState['range'] | undefined {
    const ranged = canonicalRanges[propertyName]
    const wire = limits.map(limit =>
        typeof limit === 'number'
            ? limit
            : ranged && typeof limit === 'string'
              ? canonicalRangeWireValue(ranged.id, propertyName, limit)
              : undefined
    )
    const [minimum, maximum, step] = wire
    if (minimum === undefined || maximum === undefined || step === undefined) return undefined
    return { minimum, maximum, step }
}

/** A standard descriptor's state, with its range on the property's wire scale. */
export function withWireRange(state: StandardPropertyState): PropertyState {
    const range = wireRange(state.name, [state.minimumValue, state.maximumValue, state.stepSize])
    return { ...state, ...(range ? { range } : {}) }
}

/** GetDeviceInfo for a capability read; a refusal or an empty answer fails the read. */
export async function readControlDeviceInfo(camera: GenericCamera): Promise<DeviceInfo> {
    const response = await camera.send(camera.registry.operations.GetDeviceInfo, {})
    if (response.code !== 0x2001) throw new PTPResponseError(response.code, 'Camera capability inventory refused')
    if (!response.data) throw new PTPDecodeError('Camera capability inventory has no DeviceInfo')
    return response.data
}

/** Standard PTP: each mapped property's descriptor, and FocalLength on a full read. */
export async function observeStandardControls(
    camera: GenericCamera,
    requested: CameraControlId | undefined,
    deviceInfo: DeviceInfo | undefined
): Promise<ControlObservation> {
    const mappings: ControlPropertyMap<CameraControlId> = standardControlProperties
    const requestedName = requested ? mappings[requested]?.[0]?.name : undefined
    const states = (await camera.getStandardPropertyStates(requestedName)).map(withWireRange)
    const lens = deviceInfo ? await standardLens(camera, deviceInfo.devicePropertiesSupported) : undefined
    return { states, mappings, inventory: 'standard', ...(lens ? { lens } : {}) }
}

/** Sony and Canon: the observed property, set to the vendor's choice (Kelvin as its number). */
export async function writeObservedProperty(driver: GenericCamera, { id, state, requested, vendorLabel, vendorChoice }: ControlWrite) {
    const property = propertyWithCode(driver, state.source.code)
    if (!property) throw new CameraUnsupportedError(id, 'Camera control property disappeared')
    const written = vendorChoice ? vendorChoice.raw : id === 'colorTemperature' ? Number(requested) : vendorLabel
    await driver.set(property, written as never)
}
