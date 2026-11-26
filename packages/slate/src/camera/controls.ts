import type { ExposureContext, ExposureTime, ExposureTimeInput } from '@camera/exposure-time'
import type { CameraOperationName } from '@camera/driver'
import type { TypedSettingMethods } from '@camera/settings/typed-settings'

/**
 * Canonical application vocabulary: ids, labels and search aliases (a vendor's own word is only an
 * alias). Protocol property names belong to the vendor adapters (`@vendors/<vendor>/control-properties`).
 */
export const cameraControlDefinitions = {
    shutterSpeed: {
        label: 'Shutter speed',
        aliases: ['shutter speed', 'shutter angle', 'shutterAngle', 'exposureTime', 'exposure time'],
    },
    iso: { label: 'ISO', aliases: ['sensitivity', 'exposure index', 'gain', 'EI'] },
    aperture: { label: 'Aperture', aliases: ['f number', 'f-stop', 'iris', 'T-stop'] },
    exposureMode: {
        label: 'Exposure mode',
        aliases: ['exposure mode', 'exposure program', 'shooting mode', 'PASM', 'mode dial', 'exposureProgramMode'],
    },
    exposureCompensation: {
        label: 'Exposure compensation',
        aliases: ['exposure compensation', 'EV', 'exposure comp', 'exposure bias'],
    },
    meteringMode: { label: 'Metering', aliases: ['metering mode', 'metering'] },
    photoVideoMode: {
        label: 'Photo / video',
        aliases: ['photo video', 'photo/video', 'still/movie', 'movie mode', 'video mode', 'stills', 'motion'],
    },
    driveMode: {
        label: 'Drive mode',
        aliases: ['drive', 'release mode', 'burst', 'continuous shooting', 'still capture mode'],
    },
    whiteBalance: { label: 'White balance', aliases: ['white balance', 'wb'] },
    colorTemperature: { label: 'Colour temperature', aliases: ['colour temperature', 'color temperature', 'kelvin'] },
    pictureStyle: {
        label: 'Look',
        aliases: ['look', 'picture style', 'picture control', 'creative look', 'creative style', 'film simulation'],
    },
    pictureProfile: { label: 'Picture profile', aliases: ['picture profile', 'gamma', 'log'] },
    focusMode: {
        label: 'Focus mode',
        aliases: ['focus mode', 'One-Shot', 'AI Servo', 'Movie Servo AF', 'movie servo autofocus'],
    },
    focusArea: { label: 'Focus area', aliases: ['focus area', 'AF area', 'AF method'] },
    subjectDetection: {
        label: 'Subject detection',
        aliases: ['subject recognition', 'subjectRecognition', 'eye tracking', 'eye AF', 'face detection', 'subject detection'],
    },
    detectionSubject: {
        label: 'Detection subject',
        aliases: ['recognition target', 'recognitionTarget', 'subject to detect', 'detection subject'],
    },
    eyeSelection: { label: 'Eye selection', aliases: ['eye select', 'eyeSelect', 'eye selection'] },
    /**
     * Canon's Continuous AF: in One-Shot it keeps the lens roughly focused before the AF press, then
     * locks like One-Shot. That is not AF-C, so it is a setting of its own, present only where offered.
     */
    continuousAutofocus: { label: 'Continuous AF', aliases: ['continuous AF', 'continuous autofocus'] },
    photoFormat: {
        label: 'Photo format',
        aliases: ['still format', 'stillFormat', 'image format', 'imageFormat', 'file format', 'file type', 'image quality'],
    },
    photoSize: { label: 'Photo size', aliases: ['image size', 'imageSize'] },
    aspectRatio: { label: 'Aspect ratio', aliases: ['aspect ratio'] },
    jpegQuality: { label: 'JPEG quality', aliases: ['jpeg quality'] },
    rawCompression: { label: 'RAW compression', aliases: ['raw compression', 'NEF compression', 'raw file type'] },
    flashMode: { label: 'Flash', aliases: ['flash mode', 'flash'] },
    videoFormat: { label: 'Video format', aliases: ['codec', 'movie format', 'movieFormat', 'recording format'] },
    videoQuality: {
        label: 'Video quality',
        aliases: ['resolution', 'bit rate', 'bitrate', 'record setting', 'movie setting', 'movieSetting', 'movie quality'],
    },
    frameRate: { label: 'Frame rate', aliases: ['fps', 'movie frame rate', 'movieFrameRate'] },
    audioRecording: { label: 'Audio recording', aliases: ['sound', 'movie audio', 'movie sound', 'sound recording'] },
    digitalZoom: { label: 'Digital zoom', aliases: ['zoom setting', 'zoomSetting', 'zoom mode', 'zoomMode', 'zoom range'] },
    liveViewQuality: {
        label: 'Live-view quality',
        aliases: ['live view quality', 'preview quality', 'live view image quality'],
    },
} as const

export type CameraControlId = keyof typeof cameraControlDefinitions
export type CameraControlInputs = {
    [Id in CameraControlId]: Id extends 'shutterSpeed' ? ExposureTimeInput : Id extends 'colorTemperature' ? number : string
}

/** Raw wire values the camera reported that Slate has no name for, spelled by `unrecognizedValueLabel`. */
export { unrecognizedValueLabel } from '@ptp/datasets/device-prop-desc-dataset'

export interface UnrecognizedValues {
    /**
     * The current raw value. The control is then read-only and its `value` reads `Unrecognized (<raw>)`,
     * or, when it does not apply now, has no `value` at all.
     */
    value?: string
    /** Advertised choices left out of `allowedValues`; they are never writable. */
    choices?: string[]
}

export interface CameraControlState {
    id: CameraControlId
    label: string
    aliases: readonly string[]
    /** Exact active property, retained for diagnostics. Applications route writes by id. */
    source: { name: string; code: number; protocol: 'ptp' | 'sony-sdk' }
    /**
     * The current value in Slate's spelling. Absent when the control does not apply now (`enabled:
     * false`, no choices, the raw reading in `unrecognized.value`): colour temperature under a white
     * balance preset, Sony drive mode in movie mode.
     */
    value?: string
    allowedValues?: string[]
    writable: boolean
    enabled: boolean
    range?: { minimum: number; maximum: number; step: number }
    exposureTime?: ExposureTime
    unrecognized?: UnrecognizedValues
}

export interface CameraCapabilities {
    observedAt: number
    /** Current descriptor/event observations, not a permanent model-level support guarantee. */
    controls: Partial<Record<CameraControlId, CameraControlState>>
    /** Raw standard DeviceInfo inventory, or null where unavailable; never workflow qualification. */
    advertisedOperations: number[] | null
    /** The attached lens, from the same observation as `controls`; absent when the camera reports neither field. */
    lens?: CameraLens
    /**
     * Whether each public operation is possible right now, with the reason when it is not. Camera
     * fills this from its driver's capability groups; an operation absent here has no availability
     * report yet, and a call still answers CameraUnsupportedError when it cannot run.
     */
    operations?: Partial<Record<CameraOperationName, OperationAvailability>>
}

/** The attached lens as the camera reports it. Each field is null when the camera does not report it. */
export interface CameraLens {
    name: string | null
    /** The current focal length, in millimetres. */
    focalLengthMillimetres: number | null
}

/**
 * One operation's availability now: an unsupported one says why, in words a user can act on.
 * `options` covers optional parts of an operation, such as a live-view overlay.
 */
export interface OperationAvailability {
    supported: boolean
    reason?: string
    options?: Partial<Record<string, OperationAvailability>>
}

/**
 * The same control contract on an already-connected native PTP or licensed SDK session, including
 * one typed getter and setter per typed setting (`getShutterSpeed`, `setShutterSpeed`, ...).
 */
export interface CameraControlSession extends TypedSettingMethods {
    getCapabilities(): Promise<CameraCapabilities>
    setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
}

export type CameraRecordingState = 'idle' | 'recording' | 'starting' | 'stopping' | 'unknown'

/**
 * A control whose reading means nothing now does not apply: it reports no value and no choices, its raw
 * reading kept in `unrecognized.value`. That is a colour temperature of 0 K (a Sony in a white balance
 * preset: FX2 in Auto, a6700 in Daylight), and a value with no name that is disabled or has nothing to
 * choose (Sony drive mode 0x0 in movie mode). Every vendor's observation goes through this.
 */
export function withoutInapplicableValues(
    controls: Partial<Record<CameraControlId, CameraControlState>>
): Partial<Record<CameraControlId, CameraControlState>> {
    const result: Partial<Record<CameraControlId, CameraControlState>> = {}
    for (const [id, state] of Object.entries(controls) as [CameraControlId, CameraControlState | undefined][]) {
        if (!state) continue
        const noKelvin = id === 'colorTemperature' && state.value !== undefined && Number(state.value) === 0
        const raw = state.unrecognized?.value ?? (noKelvin ? state.value : undefined)
        const nothingToChoose = !state.allowedValues?.length && !state.range && !state.unrecognized?.choices?.length
        const inapplicable = raw !== undefined && (noKelvin || state.enabled === false || nothingToChoose)
        result[id] = inapplicable
            ? {
                  id: state.id,
                  label: state.label,
                  aliases: state.aliases,
                  source: state.source,
                  enabled: false,
                  writable: false,
                  unrecognized: { value: raw },
              }
            : state
    }
    return result
}

const normalized = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '')

export function resolveCameraControl(name: string): CameraControlId | undefined {
    const requested = normalized(name)
    const matches = (id: CameraControlId) =>
        normalized(id) === requested || cameraControlDefinitions[id].aliases.some(alias => normalized(alias) === requested)
    return (Object.keys(cameraControlDefinitions) as CameraControlId[]).find(matches)
}
