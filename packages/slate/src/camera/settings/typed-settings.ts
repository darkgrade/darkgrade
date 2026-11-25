import type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import type { ExposureContext } from '@camera/exposure-time'
import { colourControlDefinitions, colourSettingReaders, type ColourSettingTypes } from '@camera/settings/colour'
import {
    canonicalExposureInput,
    exposureControlDefinitions,
    exposureSettingReaders,
    type ExposureSettingTypes,
} from '@camera/settings/exposure'
import { focusControlDefinitions, focusSettingReaders, type FocusSettingTypes } from '@camera/settings/focus'
import { liveViewControlDefinitions, liveViewSettingReaders, type LiveViewSettingTypes } from '@camera/settings/live-view'
import { modeControlDefinitions, modeSettingReaders, type ModeSettingTypes } from '@camera/settings/mode'
import { photoControlDefinitions, photoSettingReaders, type PhotoSettingTypes } from '@camera/settings/photo'
import type { SettingReaders } from '@camera/settings/setting-types'
import { videoControlDefinitions, type VideoSettingTypes } from '@camera/settings/video'
import { videoSettingReaders } from '@camera/settings/video-readers'

/** Every typed setting's value types, combined from the settings groups. */
export interface TypedSettingTypes
    extends ExposureSettingTypes,
        ModeSettingTypes,
        ColourSettingTypes,
        FocusSettingTypes,
        PhotoSettingTypes,
        VideoSettingTypes,
        LiveViewSettingTypes {}

/** The settings with a typed getter and setter. Each is a canonical control id. */
export type TypedSettingId = keyof TypedSettingTypes & CameraControlId

export type SettingValue<Id extends TypedSettingId> = TypedSettingTypes[Id]['value']
export type SettingInput<Id extends TypedSettingId> = TypedSettingTypes[Id]['input']
export type SettingOptions<Id extends TypedSettingId> = TypedSettingTypes[Id]['options']

export type SettingGetterName<Id extends string> = `get${Capitalize<Id>}`
export type SettingSetterName<Id extends string> = `set${Capitalize<Id>}`

/**
 * One getter and one setter per typed setting, declared once over `setControl`: `setShutterSpeed`
 * is `setControl('shutterSpeed', …)` and resolves to the value the camera read back; the getter
 * reads the current value. Values are the canonical names of the settings groups.
 */
export type TypedSettingMethods = {
    [Id in TypedSettingId as SettingGetterName<Id>]: () => Promise<SettingValue<Id>>
} & {
    [Id in TypedSettingId as SettingSetterName<Id>]: (
        value: SettingInput<Id>,
        ...options: SettingOptions<Id>
    ) => Promise<SettingValue<Id>>
}

/** Compile-time: a typed setter accepts only what setControl accepts for the same id. */
type InputsWithinSetControl = {
    [Id in TypedSettingId]: SettingInput<Id> extends CameraControlInputs[Id] ? true : Id
}[TypedSettingId]
const typedInputsMatchSetControl: InputsWithinSetControl extends true ? true : InputsWithinSetControl = true
void typedInputsMatchSetControl

/** Compile-time: no typed setter takes plain `string`; test:package checks the packed types too. */
type PlainStringInputs = {
    [Id in TypedSettingId]: string extends SettingInput<Id> ? Id : never
}[TypedSettingId]
const noPlainStringInputs: [PlainStringInputs] extends [never] ? true : PlainStringInputs = true
void noPlainStringInputs

export const typedSettingReaders: SettingReaders<TypedSettingTypes> = {
    ...exposureSettingReaders,
    ...modeSettingReaders,
    ...colourSettingReaders,
    ...focusSettingReaders,
    ...photoSettingReaders,
    ...videoSettingReaders,
    ...liveViewSettingReaders,
}

const settingLabels: Record<string, { label: string }> = {
    ...exposureControlDefinitions,
    ...modeControlDefinitions,
    ...colourControlDefinitions,
    ...focusControlDefinitions,
    ...photoControlDefinitions,
    ...videoControlDefinitions,
    ...liveViewControlDefinitions,
}

function isTypedSettingId(id: string): id is TypedSettingId {
    return Object.prototype.hasOwnProperty.call(typedSettingReaders, id)
}

export const typedSettingIds: readonly TypedSettingId[] = Object.keys(typedSettingReaders).filter(isTypedSettingId)

export const settingGetterName = <Id extends string>(id: Id): SettingGetterName<Id> =>
    `get${id.charAt(0).toUpperCase()}${id.slice(1)}` as SettingGetterName<Id>
export const settingSetterName = <Id extends string>(id: Id): SettingSetterName<Id> =>
    `set${id.charAt(0).toUpperCase()}${id.slice(1)}` as SettingSetterName<Id>

/** What the typed accessors need from a session: the generic control API, nothing vendor-specific. */
export interface TypedSettingHost {
    getCapabilities(): Promise<CameraCapabilities>
    setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
}

function readSetting(id: TypedSettingId, state: CameraControlState | undefined) {
    if (!state)
        throw new CameraUnsupportedError(
            id,
            `${settingLabels[id]?.label ?? id} is not available on this camera in its current mode`
        )
    return typedSettingReaders[id](state)
}

/**
 * Installs one getter and one setter per typed setting on a class whose instances implement the
 * generic control API. Camera and the Sony Wi-Fi session both install them, so every
 * CameraControlSession has the same typed settings.
 */
export function installTypedSettings(prototype: TypedSettingHost): void {
    const define = (name: string, method: (this: TypedSettingHost, ...parameters: never[]) => unknown) => {
        if (Object.prototype.hasOwnProperty.call(prototype, name))
            throw new Error(`${name} is already defined; remove it so the typed setting is the only one`)
        Object.defineProperty(prototype, name, { value: method, writable: true, configurable: true, enumerable: false })
    }
    for (const id of typedSettingIds) {
        define(settingGetterName(id), async function (this: TypedSettingHost) {
            return readSetting(id, (await this.getCapabilities()).controls[id])
        })
        define(
            settingSetterName(id),
            async function (this: TypedSettingHost, value: CameraControlInputs[TypedSettingId], context?: ExposureContext) {
                return readSetting(id, await this.setControl(id, value, context))
            }
        )
    }
}

/**
 * The canonical spelling of a requested value: each group's exact alternative spellings (`M` for
 * `Manual`, `800` for `ISO 800`). Anything else is returned unchanged and checked against the choices.
 */
export function canonicalControlInput(id: CameraControlId, value: string): string {
    return canonicalExposureInput(id, value)
}
