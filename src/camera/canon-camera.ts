import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CanonRegistry, createCanonRegistry } from '@ptp/registry'
import { EventDefinition } from '@ptp/types/event'
import { EventParams } from '@ptp/types/type-helpers'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

/**
 * TODO: reverse engineer EOS Utility with Wireshark
 *
 * Unlike other vendors Canon does not publish public docs on their PTP implementation
 *
 * They offer it under NDA which is not an option for an open-source project
 * Massive props to Julian Schroden for his work reverse-engineering Canon cameras
 * https://julianschroden.com/post/2023-04-23-analyzing-the-ptp-ip-protocol-with-wireshark/
 * https://julianschroden.com/post/2023-05-10-pairing-and-initializing-a-ptp-ip-connection-with-a-canon-eos-camera/
 * https://julianschroden.com/post/2023-05-28-controlling-properties-using-ptp-ip-on-canon-eos-cameras/
 * https://julianschroden.com/post/2023-06-15-capturing-images-using-ptp-ip-on-canon-eos-cameras/
 * https://julianschroden.com/post/2023-08-19-remote-live-view-using-ptp-ip-on-canon-eos-cameras/
 */
export class CanonCamera extends GenericCamera {
    private remoteModeEnabled = false
    private eventModeEnabled = false
    private eventPollingInterval?: NodeJS.Timeout
    private isPollingPaused = false
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

        this.sessionId = 1
        await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
        await this.enableRemoteMode()
        await this.enableEventMode()

        const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
        if (response.data && Array.isArray(response.data)) {
            response.data.forEach(event =>
                this.handleEvent({
                    code: event.code,
                    parameters: event.parameters.map(p => (typeof p === 'bigint' ? Number(p) : p)),
                    transactionId: 0,
                })
            )
        }
    }

    async disconnect(): Promise<void> {
        this.stopEventPolling()
        await this.disableRemoteMode()
        await this.disableEventMode()
        await super.disconnect()
    }

    protected handleEvent(event: PTPEvent): void {
        const eventDef = Object.values(this.registry.events).find(e => e.code === event.code)
        if (!eventDef) return

        const decodedParams: Record<string, number | bigint | string> = {}
        const encodedParams = event.parameters || []

        for (let i = 0; i < eventDef.parameters.length; i++) {
            const paramDef = eventDef.parameters[i]
            if (!paramDef || i >= encodedParams.length) continue

            const codec = this.resolveCodec(paramDef.codec)
            const rawValue = encodedParams[i]

            if (typeof rawValue === 'number' || typeof rawValue === 'bigint' || typeof rawValue === 'string') {
                const bytes = codec.encode(rawValue)
                const result = codec.decode(bytes)
                decodedParams[paramDef.name] = result.value
            } else {
                decodedParams[paramDef.name] = rawValue
            }
        }

        if (decodedParams.PropertyCode !== undefined && typeof decodedParams.PropertyCode === 'number') {
            const property = Object.values(this.registry.properties).find(p => p.code === decodedParams.PropertyCode)
            if (property) {
                decodedParams.PropertyName = property.name
            }
        }

        this.logger.addLog({
            type: 'ptp_event',
            level: 'info',
            sessionId: this.sessionId,
            eventCode: eventDef.code,
            eventName: eventDef.name,
            encodedParams,
            decodedParams,
        })

        this.emitter.emit<Record<string, number | bigint | string>>(eventDef.name, decodedParams)
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

    async getAperture(): Promise<string> {
        const value = await this.getCanonProperty(this.registry.properties.CanonAperture.code)
        return value.toString()
    }

    async setAperture(value: string): Promise<void> {
        return this.setCanonProperty(this.registry.properties.CanonAperture.code, parseInt(value))
    }

    async getShutterSpeed(): Promise<string> {
        const value = await this.getCanonProperty(this.registry.properties.CanonShutterSpeed.code)
        return value.toString()
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.setCanonProperty(this.registry.properties.CanonShutterSpeed.code, parseInt(value))
    }

    async getIso(): Promise<string> {
        const value = await this.getCanonProperty(this.registry.properties.CanonIso.code)
        return value.toString()
    }

    async setIso(value: string): Promise<void> {
        return this.setCanonProperty(this.registry.properties.CanonIso.code, parseInt(value))
    }

    private async getCanonProperty(propertyCode: number): Promise<number> {
        const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 12000)
        if (!response.data) {
            throw new Error('No event data received')
        }
        return 0
    }

    private async setCanonProperty(propertyCode: number, value: number): Promise<void> {
        const wasPolling = this.eventPollingInterval !== undefined
        if (wasPolling) {
            this.pauseEventPolling()
            await this.waitMs(250)
        }

        try {
            const codec = this.registry.codecs.uint16
            const propertyCodeBytes = codec.encode(propertyCode)
            const valueBytes = codec.encode(value)

            const data = new Uint8Array(propertyCodeBytes.length + valueBytes.length)
            data.set(propertyCodeBytes, 0)
            data.set(valueBytes, propertyCodeBytes.length)

            await this.send(this.registry.operations.CanonSetPropValue, {}, data)
        } finally {
            if (wasPolling) {
                this.resumeEventPolling()
            }
        }
    }

    async captureImage({ includeInfo = true, includeData = true }): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
        const wasPolling = this.eventPollingInterval !== undefined
        if (wasPolling) {
            this.pauseEventPolling()
            await this.waitMs(250)
        }

        try {
            await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'FOCUS' })
            await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'SHUTTER' })
            await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'SHUTTER' })
            await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })

            if (wasPolling) {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (response.data && Array.isArray(response.data)) {
                    response.data.forEach(event =>
                        this.handleEvent({
                            code: event.code,
                            parameters: event.parameters.map(p => (typeof p === 'bigint' ? Number(p) : p)),
                            transactionId: 0,
                        })
                    )
                }
            }

            return {}
        } finally {
            if (wasPolling) {
                this.resumeEventPolling()
            }
        }
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

    startEventPolling(intervalMs: number = 200): void {
        if (this.eventPollingInterval) {
            return
        }

        this.eventPollingInterval = setInterval(async () => {
            if (this.isPollingPaused) {
                return
            }

            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                    response.data.forEach(event =>
                        this.handleEvent({
                            code: event.code,
                            parameters: event.parameters.map(p => (typeof p === 'bigint' ? Number(p) : p)),
                            transactionId: 0,
                        })
                    )
                }
            } catch (error) {}
        }, intervalMs)
    }

    stopEventPolling(): void {
        if (this.eventPollingInterval) {
            clearInterval(this.eventPollingInterval)
            this.eventPollingInterval = undefined
        }
    }

    pauseEventPolling(): void {
        this.isPollingPaused = true
    }

    resumeEventPolling(): void {
        this.isPollingPaused = false
    }
}
