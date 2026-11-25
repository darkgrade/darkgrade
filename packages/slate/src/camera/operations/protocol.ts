import { CanonCamera, type CanonNetworkState, type CanonPropertyState, type CanonUnknownPropertyState } from '@camera/canon-camera'
import { CameraUnsupportedError } from '@camera/errors'
import type { GenericCamera, StandardPropertyState } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { cameraContext, isCamera, type CameraDriverInstance } from '@camera/operations/context'
import { SonyCamera, type SonyCameraButton, type SonyPropertyState } from '@camera/sony-camera'
import type { CanonExtendedDeviceInfo } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
import type { CanonLiveViewFrame } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import type { CodecType } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { OperationParams, OperationResponse } from '@ptp/types/type-helpers'
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
    let session = sessions.get(camera)
    if (!session) {
        session = createProtocolSession(camera)
        sessions.set(camera, session)
    }
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

function vendorDriver<Driver extends GenericCamera>(
    camera: Camera,
    kind: abstract new (...parameters: never[]) => Driver,
    operation: string,
    unavailable: string
): Driver {
    const { driver } = cameraContext(camera)
    if (!(driver instanceof kind)) throw new CameraUnsupportedError(operation, unavailable)
    return driver
}

const sony = (camera: Camera, operation: string, unavailable: string) => vendorDriver(camera, SonyCamera, operation, unavailable)
const nikon = (camera: Camera, operation: string, unavailable: string) => vendorDriver(camera, NikonCamera, operation, unavailable)
const canon = (camera: Camera, operation: string, unavailable = 'This control is only available for Canon EOS cameras') =>
    vendorDriver(camera, CanonCamera, operation, unavailable)

function createProtocolSession(camera: Camera): ProtocolSession {
    const driver = () => cameraContext(camera).driver
    return {
        get driver() {
            return driver()
        },
        get registry() {
            return driver().registry
        },
        get vendorId() {
            return driver().vendorId
        },
        get sessionId() {
            return driver().sessionId
        },
        send: (operation, params, data, maxDataLength) => driver().send(operation, params, data, maxDataLength),
        get: property => driver().get(property),
        readValue: property => driver().readValue(property),
        set: (property, value) => driver().set(property, value),
        getStandardPropertyStates: () => driver().getStandardPropertyStates(),
        setStandardProperty: (propertyNameOrCode, value) => driver().setStandardProperty(propertyNameOrCode, value),
        async getNikonVendorPropertyCodes() {
            return nikon(camera, 'getNikonVendorPropertyCodes', 'Nikon vendor properties require a Nikon camera').getVendorPropertyCodes()
        },
        async getSonyPropertyStates() {
            const body = sony(camera, 'getSonyPropertyStates', 'Sony property state is only available for Sony cameras')
            await body.refreshPropertyStates()
            return body.listPropertyStates()
        },
        async sonyPressButton(button, options) {
            return sony(camera, 'sonyPressButton', 'Sony camera buttons are only available for Sony cameras').pressButton(button, options)
        },
        async connectSonyMenuSession(device) {
            const body = sony(camera, 'connectSonyMenuSession', 'Sony menu sessions require a Sony camera')
            await body.connect(device || cameraContext(camera).deviceDescriptor, { mode: 'menus' })
        },
        async getCanonPropertyStates() {
            return canon(camera, 'getCanonPropertyStates', 'Canon property state is only available for Canon EOS cameras').listPropertyStates()
        },
        async getCanonUnknownPropertyStates() {
            return canon(
                camera,
                'getCanonUnknownPropertyStates',
                'Canon raw property state is only available for Canon EOS cameras'
            ).listUnknownPropertyStates()
        },
        async getCanonExtendedDeviceInfo() {
            return canon(camera, 'getCanonExtendedDeviceInfo').getExtendedDeviceInfo()
        },
        getCanonNetworkState() {
            return canon(camera, 'getCanonNetworkState', 'Canon network state is only available for Canon EOS cameras').getNetworkState()
        },
        async setCanonNetworkCommunicationMode(value, allowUnadvertised = false) {
            return canon(
                camera,
                'setCanonNetworkCommunicationMode',
                'Canon network communication mode is only available for Canon EOS cameras'
            ).setNetworkCommunicationMode(value, allowUnadvertised)
        },
        async setCanonLiveViewZoom(magnification) {
            await canon(camera, 'setCanonLiveViewZoom').setLiveViewZoom(magnification)
        },
        async getCanonLiveViewPosition() {
            return canon(camera, 'getCanonLiveViewPosition').getLiveViewPosition()
        },
        async setCanonLiveViewPosition(x, y) {
            return canon(camera, 'setCanonLiveViewPosition').setLiveViewPosition(x, y)
        },
        async panCanonLiveView(direction, step = 200) {
            return canon(camera, 'panCanonLiveView').panLiveView(direction, step)
        },
        async captureCanonViewfinderFrame() {
            return canon(camera, 'captureCanonViewfinderFrame').captureViewfinderFrame()
        },
        async keepDeviceOn() {
            return canon(camera, 'keepDeviceOn', 'KeepDeviceOn is only available for Canon EOS cameras').keepDeviceOn()
        },
    }
}

/**
 * The same protocol access as methods on Camera. Deprecated: each one leaves Camera for
 * `protocolSession(camera)` (see the operation table); they delegate so there is one implementation.
 */
export interface ProtocolOperations {
    /** @deprecated Use `protocolSession(camera).driver` from `@darkgrade/slate/protocol`. */
    getInstance(): GenericCamera
    /** @deprecated Use `protocolSession(camera).send` from `@darkgrade/slate/protocol`. */
    send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>>
    /** @deprecated Use `protocolSession(camera).get` from `@darkgrade/slate/protocol`. */
    get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>>
    /** @deprecated Use `protocolSession(camera).readValue` from `@darkgrade/slate/protocol`. */
    readValue<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>>
    /** @deprecated Use `protocolSession(camera).set` from `@darkgrade/slate/protocol`. */
    set<P extends PropertyDefinition>(
        property: P & (P['access'] extends 'Get' ? never : unknown),
        value: CodecType<P['codec']>
    ): Promise<void>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getStandardPropertyStates(): Promise<StandardPropertyState[]>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    setStandardProperty(propertyNameOrCode: string | number, value: string | number): Promise<void>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getNikonVendorPropertyCodes(): Promise<number[]>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getSonyPropertyStates(): Promise<SonyPropertyState[]>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    sonyPressButton(
        button: SonyCameraButton,
        options?: { action?: 'click' | 'press' | 'release'; holdMilliseconds?: number }
    ): Promise<void>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getCanonPropertyStates(): Promise<CanonPropertyState[]>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getCanonUnknownPropertyStates(): Promise<CanonUnknownPropertyState[]>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getCanonExtendedDeviceInfo(): Promise<CanonExtendedDeviceInfo>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getCanonNetworkState(): CanonNetworkState
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    setCanonNetworkCommunicationMode(value: number, allowUnadvertised?: boolean): Promise<void>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    setCanonLiveViewZoom(magnification: CanonLiveViewMagnification): Promise<void>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    getCanonLiveViewPosition(): ReturnType<CanonCamera['getLiveViewPosition']>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    setCanonLiveViewPosition(x: number, y: number): ReturnType<CanonCamera['setLiveViewPosition']>
    /** @deprecated Use `protocolSession(camera)` from `@darkgrade/slate/protocol`. */
    panCanonLiveView(direction: LiveViewPanDirection, step?: number): ReturnType<CanonCamera['panLiveView']>
}

export const protocolOperations: ProtocolOperations & ThisType<Camera> = {
    getInstance(): GenericCamera {
        return protocolSession(this).driver
    },

    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        return protocolSession(this).send(operation, params, data, maxDataLength)
    },

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return protocolSession(this).get(property)
    },

    async readValue<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return protocolSession(this).readValue(property)
    },

    async set<P extends PropertyDefinition>(
        property: P & (P['access'] extends 'Get' ? never : unknown),
        value: CodecType<P['codec']>
    ): Promise<void> {
        return protocolSession(this).set(property, value)
    },

    async getStandardPropertyStates() {
        return protocolSession(this).getStandardPropertyStates()
    },

    async setStandardProperty(propertyNameOrCode: string | number, value: string | number) {
        return protocolSession(this).setStandardProperty(propertyNameOrCode, value)
    },

    async getNikonVendorPropertyCodes() {
        return protocolSession(this).getNikonVendorPropertyCodes()
    },

    async getSonyPropertyStates() {
        return protocolSession(this).getSonyPropertyStates()
    },

    async sonyPressButton(button, options) {
        return protocolSession(this).sonyPressButton(button, options)
    },

    async getCanonPropertyStates() {
        return protocolSession(this).getCanonPropertyStates()
    },

    async getCanonUnknownPropertyStates() {
        return protocolSession(this).getCanonUnknownPropertyStates()
    },

    async getCanonExtendedDeviceInfo() {
        return protocolSession(this).getCanonExtendedDeviceInfo()
    },

    getCanonNetworkState() {
        return protocolSession(this).getCanonNetworkState()
    },

    async setCanonNetworkCommunicationMode(value: number, allowUnadvertised = false) {
        return protocolSession(this).setCanonNetworkCommunicationMode(value, allowUnadvertised)
    },

    async setCanonLiveViewZoom(magnification: CanonLiveViewMagnification) {
        return protocolSession(this).setCanonLiveViewZoom(magnification)
    },

    async getCanonLiveViewPosition() {
        return protocolSession(this).getCanonLiveViewPosition()
    },

    async setCanonLiveViewPosition(x: number, y: number) {
        return protocolSession(this).setCanonLiveViewPosition(x, y)
    },

    async panCanonLiveView(direction: LiveViewPanDirection, step = 200) {
        return protocolSession(this).panCanonLiveView(direction, step)
    },
}
