import type { CanonCamera, CanonNetworkState, CanonPropertyState, CanonUnknownPropertyState } from '@camera/canon-camera'
import type { GenericCamera, StandardPropertyState } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { NikonCamera } from '@camera/nikon-camera'
import { canonDriver, cameraContext } from '@camera/operations/context'
import { SonyCamera, type SonyCameraButton, type SonyPropertyState } from '@camera/sony-camera'
import type { CanonExtendedDeviceInfo } from '@ptp/datasets/vendors/canon/canon-extended-device-info-dataset'
import type { CodecType } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import type { OperationParams, OperationResponse } from '@ptp/types/type-helpers'

/**
 * Raw protocol access and vendor diagnostics. The plan moves all of these behind
 * `@darkgrade/slate/protocol` (`protocolSession(camera)`); see the operation table.
 */
export interface ProtocolOperations {
    getInstance(): GenericCamera
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
    getCanonPropertyStates(): Promise<CanonPropertyState[]>
    getCanonUnknownPropertyStates(): Promise<CanonUnknownPropertyState[]>
    /** Explicitly read advertised Canon extended capabilities; discovery does not establish writability. */
    getCanonExtendedDeviceInfo(): Promise<CanonExtendedDeviceInfo>
    getCanonNetworkState(): CanonNetworkState
    setCanonNetworkCommunicationMode(value: number, allowUnadvertised?: boolean): Promise<void>
    setCanonLiveViewZoom(magnification: 1 | 5 | 6 | 10 | 15): Promise<void>
    getCanonLiveViewPosition(): ReturnType<CanonCamera['getLiveViewPosition']>
    setCanonLiveViewPosition(x: number, y: number): ReturnType<CanonCamera['setLiveViewPosition']>
    panCanonLiveView(
        direction: 'up' | 'down' | 'left' | 'right',
        step?: number
    ): ReturnType<CanonCamera['panLiveView']>
}

export const protocolOperations: ProtocolOperations & ThisType<Camera> = {
    getInstance(): GenericCamera {
        return cameraContext(this).driver
    },

    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        return cameraContext(this).driver.send(operation, params, data, maxDataLength)
    },

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return cameraContext(this).driver.get(property)
    },

    async readValue<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return cameraContext(this).driver.readValue(property)
    },

    async set<P extends PropertyDefinition>(
        property: P & (P['access'] extends 'Get' ? never : unknown),
        value: CodecType<P['codec']>
    ): Promise<void> {
        return cameraContext(this).driver.set(property, value)
    },

    async getStandardPropertyStates(): Promise<StandardPropertyState[]> {
        return cameraContext(this).driver.getStandardPropertyStates()
    },

    async setStandardProperty(propertyNameOrCode: string | number, value: string | number): Promise<void> {
        return cameraContext(this).driver.setStandardProperty(propertyNameOrCode, value)
    },

    async getNikonVendorPropertyCodes(): Promise<number[]> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof NikonCamera)) throw new Error('Nikon vendor properties require a Nikon camera')
        return driver.getVendorPropertyCodes()
    },

    async getSonyPropertyStates(): Promise<SonyPropertyState[]> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera)) {
            throw new Error('Sony property state is only available for Sony cameras')
        }
        await driver.refreshPropertyStates()
        return driver.listPropertyStates()
    },

    async sonyPressButton(
        button: SonyCameraButton,
        options?: { action?: 'click' | 'press' | 'release'; holdMilliseconds?: number }
    ): Promise<void> {
        const { driver } = cameraContext(this)
        if (!(driver instanceof SonyCamera)) throw new Error('Sony camera buttons are only available for Sony cameras')
        return driver.pressButton(button, options)
    },

    async getCanonPropertyStates(): Promise<CanonPropertyState[]> {
        return canonDriver(this, 'Canon property state is only available for Canon EOS cameras').listPropertyStates()
    },

    async getCanonUnknownPropertyStates(): Promise<CanonUnknownPropertyState[]> {
        return canonDriver(
            this,
            'Canon raw property state is only available for Canon EOS cameras'
        ).listUnknownPropertyStates()
    },

    async getCanonExtendedDeviceInfo(): Promise<CanonExtendedDeviceInfo> {
        return canonDriver(this).getExtendedDeviceInfo()
    },

    getCanonNetworkState(): CanonNetworkState {
        return canonDriver(this, 'Canon network state is only available for Canon EOS cameras').getNetworkState()
    },

    async setCanonNetworkCommunicationMode(value: number, allowUnadvertised = false): Promise<void> {
        return canonDriver(
            this,
            'Canon network communication mode is only available for Canon EOS cameras'
        ).setNetworkCommunicationMode(value, allowUnadvertised)
    },

    async setCanonLiveViewZoom(magnification: 1 | 5 | 6 | 10 | 15): Promise<void> {
        await canonDriver(this).setLiveViewZoom(magnification)
    },

    async getCanonLiveViewPosition() {
        return canonDriver(this).getLiveViewPosition()
    },

    async setCanonLiveViewPosition(x: number, y: number) {
        return canonDriver(this).setLiveViewPosition(x, y)
    },

    async panCanonLiveView(direction: 'up' | 'down' | 'left' | 'right', step = 200) {
        return canonDriver(this).panLiveView(direction, step)
    },
}
