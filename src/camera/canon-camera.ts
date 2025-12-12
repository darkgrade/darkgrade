import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CanonRegistry, createCanonRegistry } from '@ptp/registry'
import { EventDefinition } from '@ptp/types/event'
import { EventParams } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

export class CanonCamera extends GenericCamera {
    private remoteModeEnabled = false
    private eventModeEnabled = false
    vendorId = VendorIDs.CANON
    declare public registry: CanonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createCanonRegistry(transport.isLittleEndian())
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (!this.transport.isConnected()) {
            await this.transport.connect({ ...device, ...(this.vendorId && { vendorId: this.vendorId }) })
        }

        // Canon Session ID MUST be set to 1 or we get ERR 70 (other vendors allow any session ID)
        this.sessionId = 1
        await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
        await this.enableRemoteMode()
        await this.enableEventMode()
    }

    async disconnect(): Promise<void> {
        await this.disableRemoteMode()
        await this.disableEventMode()
        await super.disconnect()
    }

    on<E extends EventDefinition>(event: E, handler: (params: EventParams<E>) => void): void {
        this.emitter.on<EventParams<E>>(event.name, handler)
    }

    off<E extends EventDefinition>(event: E, handler?: (params: EventParams<E>) => void): void {
        if (handler) {
            this.emitter.off<EventParams<E>>(event.name, handler)
        } else {
            this.emitter.removeAllListeners(event.name)
        }
    }

    // async getAperture(): Promise<string> {
    //     return this.get(this.registry.properties.Aperture)
    // }

    // async setAperture(value: string): Promise<void> {
    //     return this.set(this.registry.properties.Aperture, value)
    // }

    // async getShutterSpeed(): Promise<string> {
    //     return this.get(this.registry.properties.ShutterSpeed)
    // }

    // async setShutterSpeed(value: string): Promise<void> {
    //     return this.set(this.registry.properties.ShutterSpeed, value)
    // }

    // async getIso(): Promise<string> {
    //     return this.get(this.registry.properties.Iso)
    // }

    // async setIso(value: string): Promise<void> {
    //     return this.set(this.registry.properties.Iso, value)
    // }

    async captureImage({ includeInfo = true, includeData = true }): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
        // https://julianschroden.com/post/2023-06-15-capturing-images-using-ptp-ip-on-canon-eos-cameras/
        // https://github.com/libmtp/libmtp/blob/e85d47e74ad6541a1213f25938a1f00b537b8110/src/ptp.h#L420
        await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'FOCUS' })
        await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'SHUTTER' })
        await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'SHUTTER' })
        await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })
    }

    async enableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'ENABLE' })
        this.remoteModeEnabled = true
    }

    async disableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'DISABLE' })
        this.remoteModeEnabled = false
    }

    async enableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'ENABLE' })
        this.eventModeEnabled = true
    }

    async disableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'DISABLE' })
        this.eventModeEnabled = false
    }
}
