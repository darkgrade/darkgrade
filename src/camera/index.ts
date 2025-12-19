import { Logger } from '@core/logger'
import { LoggerConfig } from '@core/logger-config'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { StorageInfo } from '@ptp/datasets/storage-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import type { CodecType } from '@ptp/types/codec'
import { EventDefinition } from '@ptp/types/event'
import type { OperationDefinition } from '@ptp/types/operation'
import type { PropertyDefinition } from '@ptp/types/property'
import { EventParams, OperationParams, OperationResponse } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { USBTransport } from '@transport/usb/usb-transport'
import { CanonCamera } from './canon-camera'
import { GenericCamera } from './generic-camera'
import { NikonCamera } from './nikon-camera'
import { SonyCamera } from './sony-camera'

export interface CameraOptions {
    logger?: Partial<LoggerConfig>
    device?: DeviceDescriptor
}

export class Camera {
    private instance: GenericCamera | SonyCamera | NikonCamera | CanonCamera
    private deviceDescriptor?: DeviceDescriptor
    private logger: Logger
    private transport: TransportInterface

    constructor(options?: CameraOptions) {
        this.logger = new Logger(options?.logger)
        this.transport = new USBTransport(this.logger)
        this.deviceDescriptor = options?.device

        switch (options?.device?.usb?.filters?.[0]?.vendorId) {
            case VendorIDs.SONY:
                this.instance = new SonyCamera(this.transport, this.logger)
                break
            case VendorIDs.NIKON:
                this.instance = new NikonCamera(this.transport, this.logger)
                break
            case VendorIDs.CANON:
                this.instance = new CanonCamera(this.transport, this.logger)
                break
            default:
                this.instance = new GenericCamera(this.transport, this.logger)
                break
        }
    }

    getInstance(): GenericCamera {
        return this.instance
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        return this.instance.connect(device || this.deviceDescriptor)
    }

    async disconnect(): Promise<void> {
        return this.instance.disconnect()
    }

    async send<Op extends OperationDefinition>(
        operation: Op,
        params: OperationParams<Op>,
        data?: Uint8Array,
        maxDataLength?: number
    ): Promise<OperationResponse<Op>> {
        return this.instance.send(operation, params, data, maxDataLength)
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        return this.instance.get(property)
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        return this.instance.set(property, value)
    }

    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        return this.instance.on(event, handler)
    }

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        return this.instance.off(event, handler)
    }

    async getAperture(): Promise<string> {
        return this.instance.getAperture()
    }

    async setAperture(value: string): Promise<void> {
        return this.instance.setAperture(value)
    }

    async getShutterSpeed(): Promise<string> {
        return this.instance.getShutterSpeed()
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.instance.setShutterSpeed(value)
    }

    async getIso(): Promise<string> {
        return this.instance.getIso()
    }

    async setIso(value: string): Promise<void> {
        return this.instance.setIso(value)
    }

    async captureImage(params?: { includeInfo?: boolean; includeData?: boolean }) {
        return this.instance.captureImage({ includeInfo: true, includeData: true, ...params })
    }

    async captureLiveView(params?: { includeInfo?: boolean; includeData?: boolean }) {
        return this.instance.captureLiveView({ includeInfo: true, includeData: true, ...params })
    }

    async startRecording(): Promise<void> {
        return this.instance.startRecording()
    }

    async stopRecording(): Promise<void> {
        return this.instance.stopRecording()
    }

    async listObjects(): Promise<{
        [storageId: number]: {
            info: StorageInfo
            objects: { [objectHandle: number]: ObjectInfo }
        }
    }> {
        return this.instance.listObjects()
    }

    async getObject(objectHandle: number, objectSize: number): Promise<Uint8Array> {
        return this.instance.getObject(objectHandle, objectSize)
    }
}

export { CanonCamera } from './canon-camera'
export { GenericCamera } from './generic-camera'
export { NikonCamera } from './nikon-camera'
export { SonyCamera } from './sony-camera'
