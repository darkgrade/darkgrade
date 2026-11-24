import type { ExposureContext, ExposureTime, ExposureTimeInput } from '@camera/exposure-time'

/** Canonical application vocabulary. Protocol property names belong to the vendor adapters. */
export const cameraControlDefinitions = {
    shutterSpeed: {
        label: 'Shutter speed',
        aliases: ['shutter speed', 'shutter angle', 'shutterAngle', 'exposureTime', 'exposure time'],
    },
    iso: { label: 'ISO', aliases: ['sensitivity', 'exposure index'] },
    aperture: { label: 'Aperture', aliases: ['f number', 'f-stop'] },
    whiteBalance: { label: 'White balance', aliases: ['white balance'] },
    colorTemperature: { label: 'Colour temperature', aliases: ['colour temperature', 'color temperature', 'kelvin'] },
    focusMode: { label: 'Focus mode', aliases: ['focus mode'] },
    focusArea: { label: 'Focus area', aliases: ['focus area'] },
    subjectRecognition: { label: 'Eye tracking', aliases: ['subject recognition', 'eye tracking'] },
    recognitionTarget: { label: 'Recognition target', aliases: ['recognition target'] },
    eyeSelect: { label: 'Eye', aliases: ['eye select'] },
    stillFormat: { label: 'Photo format', aliases: ['still format', 'photo format', 'imageFormat'] },
    imageSize: { label: 'Photo size', aliases: ['image size', 'photo size'] },
    aspectRatio: { label: 'Aspect ratio', aliases: ['aspect ratio'] },
    jpegQuality: { label: 'JPEG quality', aliases: ['jpeg quality'] },
    movieFormat: { label: 'Movie format', aliases: ['movie format', 'recording format'] },
    movieSetting: { label: 'Movie quality', aliases: ['movie setting', 'movie quality'] },
    movieFrameRate: { label: 'Frame rate', aliases: ['frame rate'] },
    zoomMode: { label: 'Zoom mode', aliases: ['zoom mode', 'zoomSetting'] },
    liveViewQuality: { label: 'Live view quality', aliases: ['live view quality'] },
    exposureProgram: { label: 'Shooting mode', aliases: ['exposure program', 'shooting mode'] },
} as const

export type CameraControlId = keyof typeof cameraControlDefinitions
export type CameraControlInputs = {
    [Id in CameraControlId]: Id extends 'shutterSpeed'
        ? ExposureTimeInput
        : Id extends 'colorTemperature'
          ? number
          : string
}

/** Raw wire values the camera reported that Slate has no name for, spelled by `unrecognizedValueLabel`. */
export interface UnrecognizedValues {
    /** The current value; the control is then read-only and its `value` reads `Unrecognized (<raw>)`. */
    value?: string
    /** Advertised choices left out of `allowedValues`; they are never writable. */
    choices?: string[]
}

/** Hexadecimal for integers (`0x1234`), verbatim for text. */
export function unrecognizedValueLabel(raw: number | bigint | string): string {
    if (typeof raw === 'string') return raw
    return raw < 0 ? `-0x${(-raw).toString(16)}` : `0x${raw.toString(16)}`
}

export interface CameraControlState {
    id: CameraControlId
    label: string
    aliases: readonly string[]
    /** Exact active property, retained for diagnostics. Applications route writes by id. */
    source: { name: string; code: number; protocol: 'ptp' | 'sony-sdk' }
    value: string
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
}

/** The same control contract on an already-connected native PTP or licensed SDK session. */
export interface CameraControlSession {
    getCapabilities(): Promise<CameraCapabilities>
    getExposureTime(): Promise<ExposureTime>
    setExposureTime(value: ExposureTimeInput, context?: ExposureContext): Promise<void>
    setControl<Id extends CameraControlId>(
        id: Id,
        value: CameraControlInputs[Id],
        context?: ExposureContext
    ): Promise<CameraControlState>
}

export type CameraRecordingState = 'idle' | 'recording' | 'starting' | 'stopping' | 'unknown'

const normalized = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '')

export function resolveCameraControl(name: string): CameraControlId | undefined {
    const requested = normalized(name)
    return (Object.keys(cameraControlDefinitions) as CameraControlId[]).find(
        id =>
            normalized(id) === requested ||
            cameraControlDefinitions[id].aliases.some(alias => normalized(alias) === requested)
    )
}
