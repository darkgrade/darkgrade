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
 * A setting's reader: the observed value when `accepts` takes it, else CameraUnsupportedError (the
 * camera reports a value Slate has no name for). A raw value the codecs could not name is never guessed.
 */
export function settingReader<Value extends string>(
    accepts: (value: string) => value is Value = (_value: string): _value is Value => true
): SettingReader<Value> {
    return state => {
        if (state.unrecognized?.value === undefined && accepts(state.value)) return state.value
        throw new CameraUnsupportedError(state.id, `${state.label}: the camera reports a value Slate has no name for (${state.value})`)
    }
}

/** The reader for an enumerated setting whose canonical names are `values`. */
export const enumeratedSettingReader = <Value extends string>(values: readonly Value[]) =>
    settingReader((value): value is Value => (values as readonly string[]).includes(value))
