import type { CameraEventHandler, CameraEventName } from '@camera/driver'
import type { Camera, CameraOptions } from '@camera/index'
import type { Logger } from '@core/logger'
import type { CameraOperationQueue } from '@core/operation-queue'
import type { EventDefinition } from '@ptp/types/event'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import type { GenericCamera } from '@vendors/generic/generic-camera'
import type { VendorExtensionCamera } from '@vendors/generic/vendor-extension-camera'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'

export type CameraDriverInstance = GenericCamera | SonyCamera | NikonCamera | CanonCamera | VendorExtensionCamera

/**
 * The state one Camera keeps outside its public declarations. Camera reads it through
 * `cameraContext(this)`; `/protocol` and the remaining façade-taking helpers read it too.
 */
export interface CameraContext {
    /** The vendor driver; replaced once on connect when the attached body's vendor is known. */
    driver: CameraDriverInstance
    deviceDescriptor?: DeviceDescriptor
    readonly options: CameraOptions
    readonly logger: Logger
    readonly transport: TransportInterface
    readonly subscriptions: Set<{ event: EventDefinition; handler: (params: never) => void }>
    /** The `settingsChanged`/`mediaAdded` listeners, attached to the current driver. */
    readonly namedSubscriptions: { event: CameraEventName; handler: CameraEventHandler; stop: () => void }[]
    /** Serializes control writes and recording transitions on this camera. */
    readonly controlsQueue: CameraOperationQueue
}

const contexts = new WeakMap<object, CameraContext>()

export const bindCameraContext = (camera: object, context: CameraContext): void => void contexts.set(camera, context)

/** True for a constructed Camera (it has a context), false for anything shaped like one. */
export function isCamera(candidate: object): candidate is Camera {
    return contexts.has(candidate)
}

export function cameraContext(camera: object): CameraContext {
    const context = contexts.get(camera)
    if (!context) throw new Error('Camera operations must be called on a Camera instance')
    return context
}
