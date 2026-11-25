import type { ExposureContext, ExposureTime, ExposureTimeInput } from '@camera/exposure-time'
import type { CameraOperationName } from '@camera/operation-table/index'
import { colourControlDefinitions } from '@camera/settings/colour'
import { exposureControlDefinitions } from '@camera/settings/exposure'
import { focusControlDefinitions } from '@camera/settings/focus'
import { liveViewControlDefinitions } from '@camera/settings/live-view'
import { modeControlDefinitions } from '@camera/settings/mode'
import { photoControlDefinitions } from '@camera/settings/photo'
import type { TypedSettingMethods } from '@camera/settings/typed-settings'
import { videoControlDefinitions } from '@camera/settings/video'

/**
 * Canonical application vocabulary, one file per settings group under `@camera/settings`.
 * Protocol property names belong to the vendor adapters (`@vendors/control-properties`).
 */
export const cameraControlDefinitions = {
    ...exposureControlDefinitions,
    ...modeControlDefinitions,
    ...colourControlDefinitions,
    ...focusControlDefinitions,
    ...photoControlDefinitions,
    ...videoControlDefinitions,
    ...liveViewControlDefinitions,
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
export { unrecognizedValueLabel } from '@ptp/datasets/device-prop-desc-dataset'

export interface UnrecognizedValues {
    /** The current value; the control is then read-only and its `value` reads `Unrecognized (<raw>)`. */
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

const normalized = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, '')

export function resolveCameraControl(name: string): CameraControlId | undefined {
    const requested = normalized(name)
    return (Object.keys(cameraControlDefinitions) as CameraControlId[]).find(
        id =>
            normalized(id) === requested ||
            cameraControlDefinitions[id].aliases.some(alias => normalized(alias) === requested)
    )
}
