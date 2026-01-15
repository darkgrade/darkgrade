import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CanonRegistry, createCanonRegistry } from '@ptp/registry'
import type { CodecType } from '@ptp/types/codec'
import type { PropertyDefinition } from '@ptp/types/property'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportInterface } from '@transport/interfaces/transport.interface'
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
    private async withoutPolling<T>(fn: () => Promise<T>): Promise<T> {
        const wasPolling = !!this.pollingInterval
        if (wasPolling) {
            this.stopPolling()
        }
        try {
            return await fn()
        } finally {
            if (wasPolling) {
                this.startPolling()
            }
        }
    }
    private pollingInterval?: NodeJS.Timeout
    private liveViewEnabled = false
    private propertyCache = new Map<
        PropertyDefinition,
        { current: CodecType<PropertyDefinition['codec']>; allowed?: CodecType<PropertyDefinition['codec']>[] }
    >()
    vendorId = VendorIDs.CANON
    declare public registry: CanonRegistry

    constructor(transport: TransportInterface, logger: Logger) {
        super(transport, logger)
        this.registry = createCanonRegistry(transport.isLittleEndian())
        logger.setRegistry(this.registry)
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (!this.transport.isConnected()) {
            await this.transport.connect({ ...device, ...(this.vendorId && { vendorId: this.vendorId }) })
        }

        this.sessionId = 1
        await this.send(this.registry.operations.OpenSession, { SessionID: this.sessionId })
        await this.enableRemoteMode()
        await this.enableEventMode()

        // Flush initial property dump from camera and cache all properties
        await this.flushInitialEvents()

        this.startPolling()
    }

    async disconnect(): Promise<void> {
        this.stopPolling()
        await this.disableLiveView()
        await this.disableRemoteMode()
        await this.disableEventMode()
        await super.disconnect()
    }

    async get<P extends PropertyDefinition>(property: P): Promise<CodecType<P['codec']>> {
        if (!property.access.includes('Get')) {
            throw new Error(`Property ${property.name} is not readable`)
        }

        const cached = this.propertyCache.get(property)
        if (!cached) {
            throw new Error(
                `Property ${property.name} (0x${property.code.toString(16)}) not found in cache. The camera may not support this property or event mode is not enabled.`
            )
        }

        return cached.current as CodecType<P['codec']>
    }

    async set<P extends PropertyDefinition>(property: P, value: CodecType<P['codec']>): Promise<void> {
        return this.withoutPolling(async () => {
            if (!property.access.includes('Set')) {
                throw new Error(`Property ${property.name} is not writable`)
            }

            const codec = this.resolveCodec(property.codec)
            const encodedValue = codec.encode(value)

            const u32Codec = this.registry.codecs.uint32

            const totalSize = 12
            const data = new Uint8Array(totalSize)

            const sizeBytes = u32Codec.encode(totalSize)
            data.set(sizeBytes, 0)

            const propCodeBytes = u32Codec.encode(property.code)
            data.set(propCodeBytes, 4)

            data.set(encodedValue, 8)

            let retries = 0
            const maxRetries = 5

            while (retries < maxRetries) {
                try {
                    await this.send(this.registry.operations.CanonSetDevicePropValue, {}, data)
                    break
                } catch (error: any) {
                    if (error.code === 0x2019) {
                        retries++
                        if (retries < maxRetries) {
                            await new Promise(resolve => setTimeout(resolve, 100))
                            continue
                        }
                    }
                    throw error
                }
            }

            await new Promise(resolve => setTimeout(resolve, 100))

            while (true) {
                try {
                    const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                    if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                        break
                    }
                    this.processEvents(response.data, true)
                } catch (error) {
                    break
                }
            }
        })
    }

    async getAperture(): Promise<string> {
        return this.get(this.registry.properties.CanonAperture)
    }

    async setAperture(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonAperture,
            value as CodecType<typeof this.registry.properties.CanonAperture.codec>
        )
    }

    async getShutterSpeed(): Promise<string> {
        return this.get(this.registry.properties.CanonShutterSpeed)
    }

    async setShutterSpeed(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonShutterSpeed,
            value as CodecType<typeof this.registry.properties.CanonShutterSpeed.codec>
        )
    }

    async getIso(): Promise<string> {
        return this.get(this.registry.properties.CanonIso)
    }

    async setIso(value: string): Promise<void> {
        return this.set(
            this.registry.properties.CanonIso,
            value as CodecType<typeof this.registry.properties.CanonIso.codec>
        )
    }

    async captureImage({ includeInfo = true, includeData = true } = {}): Promise<{
        info?: ObjectInfo
        data?: Uint8Array
    }> {
        return this.withoutPolling(async () => {
            await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'FOCUS', AFMode: 'AF' })
            await new Promise(resolve => setTimeout(resolve, 1000))
            await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'SHUTTER', AFMode: 'AF' })
            await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'SHUTTER' })
            await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })

            return {}
        })
    }

    async startRecording(): Promise<void> {
        await this.enableLiveView()

        await this.set(this.registry.properties.CanonRecordingDestination, 'CARD')
    }

    async stopRecording(): Promise<void> {
        await this.set(this.registry.properties.CanonRecordingDestination, 'NONE')
    }

    private getPropertyAllowedValues<P extends PropertyDefinition>(property: P): CodecType<P['codec']>[] | undefined {
        const cached = this.propertyCache.get(property)
        if (!cached?.allowed) {
            return undefined
        }

        return cached.allowed as CodecType<P['codec']>[]
    }

    private async enableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'ENABLE' })
    }

    private async disableRemoteMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetRemoteMode, { RemoteMode: 'DISABLE' })
    }

    private async enableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'ENABLE' })
    }

    private async disableEventMode(): Promise<void> {
        await this.send(this.registry.operations.CanonSetEventMode, { EventMode: 'DISABLE' })
    }

    private processEvents(
        events: Array<{
            code: number
            parameters: Array<number | bigint>
            allowedValues?: number[]
        }>,
        emitGenericEvents = true
    ): void {
        events.forEach(event => {
            if (emitGenericEvents) {
                this.handleEvent({
                    code: event.code,
                    parameters: event.parameters.map(p => (typeof p === 'bigint' ? Number(p) : p)),
                    transactionId: 0,
                })
            }

            if (event.code === 0xc189 && event.parameters && event.parameters.length >= 2) {
                const propCode =
                    typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                const rawValue =
                    typeof event.parameters[1] === 'bigint' ? Number(event.parameters[1]) : event.parameters[1]

                const property = Object.values(this.registry.properties).find(p => p.code === propCode)
                if (property) {
                    const codec = this.resolveCodec(property.codec)
                    const encoded = this.registry.codecs.uint16.encode(rawValue)
                    const decoded = codec.decode(encoded)

                    const existing = this.propertyCache.get(property)
                    this.propertyCache.set(property, {
                        current: decoded.value,
                        allowed: existing?.allowed,
                    })
                }
            }

            if (event.code === 0xc18a) {
                if (event.parameters && event.parameters.length >= 1) {
                    const propCode =
                        typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                    if (event.allowedValues && event.allowedValues.length > 0) {
                        const property = Object.values(this.registry.properties).find(p => p.code === propCode)
                        if (property) {
                            const codec = this.resolveCodec(property.codec)
                            const decodedAllowed = event.allowedValues.map(rawValue => {
                                const encoded = this.registry.codecs.uint16.encode(rawValue)
                                const decoded = codec.decode(encoded)
                                return decoded.value
                            })

                            const existing = this.propertyCache.get(property)
                            if (existing) {
                                this.propertyCache.set(property, {
                                    current: existing.current,
                                    allowed: decodedAllowed,
                                })
                            }
                        }
                    }
                }
            }
        })
    }

    private startPolling(intervalMs: number = 200): void {
        if (this.pollingInterval) {
            return
        }

        this.pollingInterval = setInterval(async () => {
            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                    this.processEvents(response.data, true)
                }
            } catch (error) {}
        }, intervalMs)
    }

    private stopPolling(): void {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval)
            this.pollingInterval = undefined
        }
    }

    private async flushInitialEvents(): Promise<void> {
        while (true) {
            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (!response.data || !Array.isArray(response.data) || response.data.length === 0) {
                    break
                }
                this.processEvents(response.data, false)
            } catch (error) {
                break
            }
        }

        const propertiesWithAllowedValues = Array.from(this.propertyCache.values()).filter(p => p.allowed).length
        console.log(
            `Initial flush complete: ${this.propertyCache.size} properties cached, ${propertiesWithAllowedValues} properties with allowed values`
        )
    }
    private async enableLiveView(): Promise<void> {
        if (!this.liveViewEnabled) {
            await this.set(this.registry.properties.CanonLiveViewMode, 'CAMERA_AND_HOST')
            this.liveViewEnabled = true
        }
    }

    private async disableLiveView(): Promise<void> {
        if (this.liveViewEnabled) {
            await this.set(this.registry.properties.CanonLiveViewMode, 'CAMERA')
            this.liveViewEnabled = false
        }
    }
}
