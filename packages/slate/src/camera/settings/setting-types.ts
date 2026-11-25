import type { CameraControlState } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'

/**
 * The types of one typed setting.
 * - `value`: what its getter returns and its setter resolves to, in canonical spelling.
 * - `input`: what its setter accepts (the value, plus any other exact spelling such as an
 *   `ExposureTime` object). Never plain `string`: test:package rejects that.
 * - `options`: extra setter arguments, such as the frame rate a shutter-angle conversion needs.
 */
export interface SettingTypes<Value, Input = Value, Options extends unknown[] = []> {
    value: Value
    input: Input
    options: Options
}

/** Converts a confirmed control observation into a setting's canonical value. */
export type SettingReader<Value> = (state: CameraControlState) => Value

/** One reader per typed setting in a group. */
export type SettingReaders<Types> = {
    [Id in keyof Types]: SettingReader<Types[Id] extends { value: infer Value } ? Value : never>
}

/**
 * The reader for an enumerated setting whose canonical names are its codec names: the observed
 * value is returned as is, and a raw value the codecs have no name for is reported, never guessed.
 */
export function namedSettingReader<Value extends string>(label: string): SettingReader<Value> {
    return state => {
        if (state.unrecognized?.value !== undefined)
            throw new CameraUnsupportedError(
                state.id,
                `${label}: the camera reports a value Slate has no name for (${state.value})`
            )
        return state.value as Value
    }
}

/**
 * The reader for an enumerated setting: the observation's value when it is one of the canonical
 * names, else CameraUnsupportedError (the camera reports a value Slate has no name for).
 */
export function enumeratedSettingReader<Value extends string>(
    id: string,
    values: readonly Value[]
): SettingReader<Value> {
    const isCanonical = (value: string): value is Value => (values as readonly string[]).includes(value)
    return state => {
        if (isCanonical(state.value)) return state.value
        throw new CameraUnsupportedError(id, `${state.label} reads ${state.value}, which has no canonical name`)
    }
}
