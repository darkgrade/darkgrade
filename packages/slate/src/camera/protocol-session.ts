import { CanonCamera, type CanonNetworkState, type CanonPropertyState, type CanonUnknownPropertyState } from '@vendors/canon/canon-camera'
import { CameraUnsupportedError } from '@camera/errors'
import type { GenericCamera, StandardPropertyState } from '@vendors/generic/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@vendors/nikon/nikon-camera'
import { cameraContext, isCamera, type CameraDriverInstance } from '@camera/camera-context'
import { SonyCamera, type SonyCameraButton, type SonyPropertyState } from '@vendors/sony/sony-camera'
import type { CanonExtendedDeviceInfo } from '@vendors/canon/datasets/canon-extended-device-info-dataset'
import type { CanonLiveViewFrame } from '@vendors/canon/datasets/canon-live-view-dataset'
import type { CodecType } from '@ptp/types/codec'
import type { EventDefinition } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import type { DeviceDescriptor } from '@transport/interfaces/device.interface'

export type CanonLiveViewMagnification = 1 | 5 | 6 | 10 | 15
export type LiveViewPanDirection = 'up' | 'down' | 'left' | 'right'

/**
 * Raw protocol access to one Camera, for bench diagnostics. Unsupported: nothing here is part of
 * the public camera API, names follow the vendors' own protocol, and none of it is confirmed the
 * way Camera operations are. Obtain it with `protocolSession(camera)` from
 * `@darkgrade/slate/protocol`. It shares the Camera's session and driver; it never opens its own.
 */
export interface ProtocolSession {
    /** The vendor driver serving the Camera now. connect() replaces it once the body's vendor is known. */
    readonly driver: CameraDriverInstance
    /** The current driver's operation, property, event and response definitions. */
    readonly registry: CameraDriverInstance['registry']
    readonly vendorId: number | null
    readonly sessionId: number | null
    send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>>
    get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>>
    /**
     * Read GetDevicePropValue using the supplied property's known codec.
     * This does not discover descriptor datatype overrides or allowed values.
     */
    readValue<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>>
    set<P extends PropertyDefinition>(
        property: P & (P['access'] extends 'Get' ? never : unknown),
        value: CodecType<P['codec']>
    ): Promise<void>
    /**
     * Delivers one raw PTP event's decoded parameters. Kept across the driver swap connect() makes;
     * an explicit disconnect() drops it. Camera's own `on` takes the named events.
     */
    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void
    /** Stops `handler`, or every handler of the raw event when none is given. */
    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void
    getStandardPropertyStates(): Promise<StandardPropertyState[]>
    setStandardProperty(propertyNameOrCode: string | number, value: string | number): Promise<void>
    getNikonVendorPropertyCodes(): Promise<number[]>
    getSonyPropertyStates(): Promise<SonyPropertyState[]>
    sonyPressButton(
        button: SonyCameraButton,
        options?: { action?: 'click' | 'press' | 'release'; holdMilliseconds?: number }
    ): Promise<void>
    /** Opens a Sony contents-transfer session for body-menu controls, in place of the remote session. */
    connectSonyMenuSession(device?: DeviceDescriptor): Promise<void>
    getCanonPropertyStates(): Promise<CanonPropertyState[]>
    getCanonUnknownPropertyStates(): Promise<CanonUnknownPropertyState[]>
    /** Explicitly read advertised Canon extended capabilities; discovery does not establish writability. */
    getCanonExtendedDeviceInfo(): Promise<CanonExtendedDeviceInfo>
    getCanonNetworkState(): CanonNetworkState
    setCanonNetworkCommunicationMode(value: number, allowUnadvertised?: boolean): Promise<void>
    setCanonLiveViewZoom(magnification: CanonLiveViewMagnification): Promise<void>
    getCanonLiveViewPosition(): ReturnType<CanonCamera['getLiveViewPosition']>
    setCanonLiveViewPosition(x: number, y: number): ReturnType<CanonCamera['setLiveViewPosition']>
    panCanonLiveView(direction: LiveViewPanDirection, step?: number): ReturnType<CanonCamera['panLiveView']>
    /** One Canon EVF frame with its raw dataset; live view and pacing are otherwise Slate's. */
    captureCanonViewfinderFrame(): Promise<CanonLiveViewFrame>
    /** An explicit Canon KeepDeviceOn; connected sessions already send it every ten seconds. */
    keepDeviceOn(): Promise<void>
}

const sessions = new WeakMap<object, ProtocolSession>()

/**
 * The protocol session of a Camera, the same object on every call. Anything else, including a
 * Camera constructed by another copy of Slate, throws rather than returning a wrong value.
 */
export function protocolSession(camera: Camera): ProtocolSession {
    if (typeof camera !== 'object' || camera === null || !isCamera(camera))
        throw new TypeError('protocolSession must be called on a Camera instance')
    const session = sessions.get(camera) ?? createProtocolSession(camera)
    sessions.set(camera, session)
    return session
}

/**
 * @internal For Slate's own helpers, which accept a Camera or a value already shaped like its
 * protocol session (a session obtained earlier, or a test double). Not exported from
 * `@darkgrade/slate/protocol`.
 */
export function protocolAccess(camera: Camera): ProtocolSession
export function protocolAccess<Session extends Partial<ProtocolSession>>(
    target: Camera | Session
): ProtocolSession | Exclude<Session, Camera>
export function protocolAccess(target: object): object {
    return isCamera(target) ? protocolSession(target) : target
}

const vendorDriver =
    <Driver extends GenericCamera>(kind: () => abstract new (...parameters: never[]) => Driver, bodies: string) =>
    (camera: Camera, operation: string): Driver => {
        const { driver } = cameraContext(camera)
        if (!(driver instanceof kind())) throw new CameraUnsupportedError(operation, `${operation} is only available for ${bodies}`)
        return driver
    }

// Classes are looked up at call time: the vendor driver modules import this one.
const sony = vendorDriver(() => SonyCamera, 'Sony cameras')
const nikon = vendorDriver(() => NikonCamera, 'Nikon cameras')
const canon = vendorDriver(() => CanonCamera, 'Canon EOS cameras')

function createProtocolSession(camera: Camera): ProtocolSession {
    const driver = () => cameraContext(camera).driver
    return {
        get driver() { return driver() },
        get registry() { return driver().registry },
        get vendorId() { return driver().vendorId },
        get sessionId() { return driver().sessionId },
        send: (operation, params, data, maxDataLength) => driver().send(operation, params, data, maxDataLength),
        get: property => driver().get(property),
        readValue: property => driver().readValue(property),
        set: (property, value) => driver().set(property, value),
        on(event, handler) {
            cameraContext(camera).subscriptions.add({ event, handler })
            driver().on(event, handler)
        },
        off(event, handler) {
            const { subscriptions } = cameraContext(camera)
            for (const subscription of subscriptions)
                if (subscription.event.name === event.name && (!handler || subscription.handler === handler))
                    subscriptions.delete(subscription)
            driver().off(event, handler)
        },
        getStandardPropertyStates: () => driver().getStandardPropertyStates(),
        setStandardProperty: (propertyNameOrCode, value) => driver().setStandardProperty(propertyNameOrCode, value),
        getNikonVendorPropertyCodes: async () => nikon(camera, 'getNikonVendorPropertyCodes').getVendorPropertyCodes(),
        async getSonyPropertyStates() {
            const body = sony(camera, 'getSonyPropertyStates')
            await body.refreshPropertyStates()
            return body.listPropertyStates()
        },
        sonyPressButton: async (button, options) => sony(camera, 'sonyPressButton').pressButton(button, options),
        async connectSonyMenuSession(device) {
            const body = sony(camera, 'connectSonyMenuSession')
            await body.connect(device || cameraContext(camera).deviceDescriptor, { mode: 'menus' })
        },
        getCanonPropertyStates: async () => canon(camera, 'getCanonPropertyStates').listPropertyStates(),
        getCanonUnknownPropertyStates: async () => canon(camera, 'getCanonUnknownPropertyStates').listUnknownPropertyStates(),
        getCanonExtendedDeviceInfo: async () => canon(camera, 'getCanonExtendedDeviceInfo').getExtendedDeviceInfo(),
        getCanonNetworkState: () => canon(camera, 'getCanonNetworkState').getNetworkState(),
        setCanonNetworkCommunicationMode: async (value, allowUnadvertised = false) =>
            canon(camera, 'setCanonNetworkCommunicationMode').setNetworkCommunicationMode(value, allowUnadvertised),
        async setCanonLiveViewZoom(magnification) {
            await canon(camera, 'setCanonLiveViewZoom').setLiveViewZoom(magnification)
        },
        getCanonLiveViewPosition: async () => canon(camera, 'getCanonLiveViewPosition').getLiveViewPosition(),
        setCanonLiveViewPosition: async (x, y) => canon(camera, 'setCanonLiveViewPosition').setLiveViewPosition(x, y),
        panCanonLiveView: async (direction, step = 200) => canon(camera, 'panCanonLiveView').panLiveView(direction, step),
        captureCanonViewfinderFrame: async () => canon(camera, 'captureCanonViewfinderFrame').captureViewfinderFrame(),
        keepDeviceOn: async () => canon(camera, 'keepDeviceOn').keepDeviceOn(),
    }
}
