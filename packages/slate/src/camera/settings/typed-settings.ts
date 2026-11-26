import type { CameraCapabilities, CameraControlId, CameraControlInputs, CameraControlState } from '@camera/controls'
import { cameraControlDefinitions } from '@camera/controls'
import { CameraUnsupportedError } from '@camera/errors'
import type { ExposureContext, ExposureTime } from '@camera/exposure-time'
import {
    canonicalExposureInput,
    digitalZoomValues,
    exposureModes,
    formatShutterSpeed,
    isAperture,
    isExposureCompensation,
    isIso,
    liveViewQualityValues,
    meteringModes,
    type Aperture,
    type AspectRatio,
    type AudioRecording,
    type ColorTemperature,
    type ContinuousAutofocus,
    type DetectionSubject,
    type DigitalZoom,
    type DriveMode,
    type ExposureCompensation,
    type ExposureMode,
    type ExposureModeAlias,
    type EyeSelection,
    type FlashMode,
    type FocusArea,
    type FocusMode,
    type FrameRate,
    type Iso,
    type JpegQuality,
    type LiveViewQuality,
    type MeteringMode,
    type PhotoFormat,
    type PhotoSize,
    type PhotoVideoMode,
    type PictureProfile,
    type PictureStyle,
    type RawCompression,
    type ShutterSpeed,
    type SubjectDetection,
    type VideoFormat,
    type VideoQuality,
    type WhiteBalance,
} from '@camera/settings/values'
import { namedControlValues, videoCodecValueNames } from '@vendors/control-properties'

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

/**
 * Every typed setting's value types. Each id listed here gets `get<Id>()` and `set<Id>(value)` on
 * Camera and on every CameraControlSession. Values are the canonical names of `@camera/settings/values`.
 */
export interface TypedSettingTypes {
    shutterSpeed: SettingTypes<ShutterSpeed, ShutterSpeed | ExposureTime, [context?: ExposureContext]>
    aperture: SettingTypes<Aperture>
    iso: SettingTypes<Iso>
    exposureMode: SettingTypes<ExposureMode, ExposureMode | ExposureModeAlias>
    exposureCompensation: SettingTypes<ExposureCompensation>
    meteringMode: SettingTypes<MeteringMode>
    photoVideoMode: SettingTypes<PhotoVideoMode>
    driveMode: SettingTypes<DriveMode>
    whiteBalance: SettingTypes<WhiteBalance>
    colorTemperature: SettingTypes<ColorTemperature>
    pictureStyle: SettingTypes<PictureStyle>
    pictureProfile: SettingTypes<PictureProfile>
    focusMode: SettingTypes<FocusMode>
    focusArea: SettingTypes<FocusArea>
    subjectDetection: SettingTypes<SubjectDetection>
    continuousAutofocus: SettingTypes<ContinuousAutofocus>
    detectionSubject: SettingTypes<DetectionSubject>
    eyeSelection: SettingTypes<EyeSelection>
    photoFormat: SettingTypes<PhotoFormat>
    photoSize: SettingTypes<PhotoSize>
    aspectRatio: SettingTypes<AspectRatio>
    jpegQuality: SettingTypes<JpegQuality>
    rawCompression: SettingTypes<RawCompression>
    flashMode: SettingTypes<FlashMode>
    videoFormat: SettingTypes<VideoFormat>
    videoQuality: SettingTypes<VideoQuality>
    frameRate: SettingTypes<FrameRate>
    audioRecording: SettingTypes<AudioRecording>
    digitalZoom: SettingTypes<DigitalZoom>
    liveViewQuality: SettingTypes<LiveViewQuality>
}

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
 * reads the current value. Values are the canonical names of `@camera/settings/values`.
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

/** Converts a confirmed control observation into a setting's canonical value. */
type SettingReader<Value> = (state: CameraControlState) => Value

/**
 * A setting's reader: the observed value when `accepts` takes it, else CameraUnsupportedError (the
 * camera reports a value Slate has no name for). A raw value the codecs could not name is never guessed.
 */
function settingReader<Value extends string>(
    accepts: (value: string) => value is Value = (_value: string): _value is Value => true
): SettingReader<Value> {
    return state => {
        if (state.value !== undefined && state.unrecognized?.value === undefined && accepts(state.value)) return state.value
        throw new CameraUnsupportedError(state.id, `${state.label}: the camera reports a value Slate has no name for (${state.value})`)
    }
}

/** The reader for an enumerated setting whose canonical names are `values`. */
const enumeratedSettingReader = <Value extends string>(values: Iterable<string>) => {
    const known = new Set(values)
    return settingReader((value): value is Value => known.has(value))
}

const canonMovieRecordPattern = /^.+ fps · (MOV|MP4|unknown) · (ALL-I|IPB \(Standard\)|IPB \(Light\)|unknown)$/

function isVideoFormat(value: string): value is VideoFormat {
    return videoCodecValueNames('videoFormat').has(value) || canonMovieRecordPattern.test(value)
}

/** Converts a confirmed observation into each typed setting's canonical value. */
export const typedSettingReaders: { [Id in TypedSettingId]: SettingReader<SettingValue<Id>> } = {
    shutterSpeed: state => formatShutterSpeed(state.exposureTime, state.value),
    aperture: settingReader(isAperture),
    iso: settingReader(isIso),
    exposureMode: enumeratedSettingReader<ExposureMode>(exposureModes),
    exposureCompensation: settingReader(isExposureCompensation),
    meteringMode: enumeratedSettingReader<MeteringMode>(meteringModes),
    photoVideoMode: enumeratedSettingReader<PhotoVideoMode>(['photo', 'video']),
    driveMode: settingReader<DriveMode>(),
    whiteBalance: settingReader<WhiteBalance>(),
    colorTemperature: state => {
        // An a6700 in Daylight reports ColorTemperature disabled at 0: the setting does not apply now.
        if (state.enabled === false)
            throw new CameraUnsupportedError('colorTemperature', colourTemperatureInapplicable)
        const kelvin = Number(state.value)
        const unreadable = `Colour temperature: the camera reports a value Slate cannot read (${state.value})`
        if (state.unrecognized?.value !== undefined || !Number.isFinite(kelvin) || kelvin <= 0)
            throw new CameraUnsupportedError('colorTemperature', unreadable)
        return kelvin
    },
    pictureStyle: settingReader<PictureStyle>(),
    pictureProfile: settingReader<PictureProfile>(),
    focusMode: enumeratedSettingReader<FocusMode>(namedControlValues('focusMode')),
    focusArea: enumeratedSettingReader<FocusArea>(namedControlValues('focusArea')),
    subjectDetection: enumeratedSettingReader<SubjectDetection>(namedControlValues('subjectDetection')),
    continuousAutofocus: enumeratedSettingReader<ContinuousAutofocus>(namedControlValues('continuousAutofocus')),
    detectionSubject: enumeratedSettingReader<DetectionSubject>(namedControlValues('detectionSubject')),
    eyeSelection: enumeratedSettingReader<EyeSelection>(namedControlValues('eyeSelection')),
    photoFormat: settingReader<PhotoFormat>(),
    photoSize: settingReader<PhotoSize>(),
    aspectRatio: settingReader<AspectRatio>(),
    jpegQuality: settingReader<JpegQuality>(),
    rawCompression: settingReader<RawCompression>(),
    flashMode: settingReader<FlashMode>(),
    videoFormat: settingReader(isVideoFormat),
    videoQuality: settingReader((value): value is VideoQuality => videoCodecValueNames('videoQuality').has(value)),
    frameRate: settingReader((value): value is FrameRate => videoCodecValueNames('frameRate').has(value)),
    audioRecording: settingReader((value): value is AudioRecording => videoCodecValueNames('audioRecording').has(value)),
    digitalZoom: enumeratedSettingReader<DigitalZoom>(digitalZoomValues),
    liveViewQuality: enumeratedSettingReader<LiveViewQuality>(liveViewQualityValues),
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

const colourTemperatureInapplicable =
    'Colour temperature does not apply with the current white balance; choose Color Temperature first'
const inapplicableReasons: Partial<Record<TypedSettingId, string>> = { colorTemperature: colourTemperatureInapplicable }

function readSetting(id: TypedSettingId, state: CameraControlState | undefined) {
    if (!state)
        throw new CameraUnsupportedError(
            id,
            `${cameraControlDefinitions[id].label} is not available on this camera in its current mode`
        )
    // A setting with no value does not apply now (withoutInapplicableValues: Sony drive mode 0x0 in movie mode).
    if (state.value === undefined)
        throw new CameraUnsupportedError(id, inapplicableReasons[id] ?? `${state.label} does not apply in the camera's current mode`)
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
 * The canonical spelling of a requested value: its exact alternative spellings (`M` for
 * `Manual`, `800` for `ISO 800`). Anything else is returned unchanged and checked against the choices.
 */
export function canonicalControlInput(id: CameraControlId, value: string): string {
    return canonicalExposureInput(id, value)
}
