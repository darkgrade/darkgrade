import { CanonCamera } from '@camera/canon-camera'
import type { CameraCapabilities } from '@camera/controls'
import type { CameraDriverCapabilities, CapabilityArea } from '@camera/driver/contract'
import { CameraUnsupportedError } from '@camera/errors'
import type { GenericCamera } from '@camera/generic-camera'
import type { Camera, CameraOptions } from '@camera/index'
import type { NikonCamera } from '@camera/nikon-camera'
import type { SonyCamera } from '@camera/sony-camera'
import type { VendorExtensionCamera } from '@camera/vendor-extension-camera'
import type { Logger } from '@core/logger'
import type { CameraOperationQueue } from '@core/operation-queue'
import type { EventDefinition } from '@ptp/types/event'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { resolveDriverCapabilities } from '@vendors/capabilities'

export type CameraDriverInstance = GenericCamera | SonyCamera | NikonCamera | CanonCamera | VendorExtensionCamera

/**
 * The state one Camera shares between its per-area operation modules. It is internal: the area
 * modules under `@camera/operations` read it through `cameraContext(this)`, and nothing outside
 * the Camera façade receives it.
 */
export interface CameraContext {
    /** The vendor driver; replaced once on connect when the attached body's vendor is known. */
    driver: CameraDriverInstance
    deviceDescriptor?: DeviceDescriptor
    readonly options: CameraOptions
    readonly logger: Logger
    readonly transport: TransportInterface
    readonly subscriptions: Set<{ event: EventDefinition; handler: (params: never) => void }>
    /** Serializes control writes and recording transitions on this camera. */
    readonly controlsQueue: CameraOperationQueue
}

/** The Canon driver, for the Canon-only operations that remain until their generic replacement lands. */
export function canonDriver(
    camera: object,
    unavailable = 'This control is only available for Canon EOS cameras'
): CanonCamera {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof CanonCamera)) throw new Error(unavailable)
    return driver
}

const contexts = new WeakMap<object, CameraContext>()
const capabilities = new WeakMap<CameraDriverInstance, CameraDriverCapabilities>()

/**
 * The current driver's capability groups (the driver contract). Resolved once per driver, so a
 * driver replaced on connect gets its own. Area operations call this instead of branching on
 * vendor classes.
 */
export function driverCapabilities(camera: Camera): CameraDriverCapabilities {
    const { driver } = cameraContext(camera)
    let resolved = capabilities.get(driver)
    if (!resolved) {
        resolved = resolveDriverCapabilities(driver, camera)
        capabilities.set(driver, resolved)
    }
    return resolved
}

/**
 * Which operations the current driver can do now, from an observation already made (no reads).
 * Each capability group with an `availability` report adds its operations here.
 */
export function operationAvailability(camera: Camera, capabilities: CameraCapabilities): CameraCapabilities['operations'] {
    const groups = driverCapabilities(camera)
    return { ...groups.focus?.availability(capabilities) }
}

/** One capability group, or CameraUnsupportedError naming the operation that needed it. */
export function requireCapability<Area extends CapabilityArea>(
    camera: Camera,
    area: Area,
    operation: string
): NonNullable<CameraDriverCapabilities[Area]> {
    const capability = driverCapabilities(camera)[area]
    if (!capability) throw new CameraUnsupportedError(operation, `${operation} is not supported by this camera`)
    return capability
}

export function bindCameraContext(camera: object, context: CameraContext): void {
    contexts.set(camera, context)
}

export function cameraContext(camera: object): CameraContext {
    const context = contexts.get(camera)
    if (!context) throw new Error('Camera operations must be called on a Camera instance')
    return context
}

/**
 * Adds one area's operations to the Camera prototype with class-method semantics
 * (non-enumerable, replaceable by test spies). Each area declares its methods in an interface
 * that `Camera` extends, so the compiler sees every method the prototype receives.
 */
export function installCameraOperations(prototype: object, operations: object): void {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(operations))) {
        if (Object.prototype.hasOwnProperty.call(prototype, name))
            throw new Error(`Camera operation ${name} is defined by two areas`)
        Object.defineProperty(prototype, name, { ...descriptor, enumerable: false })
    }
}
