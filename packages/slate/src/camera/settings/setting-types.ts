import type { CameraControlState } from '@camera/controls'

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
