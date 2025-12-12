import { Logger } from '@core/logger'
import { ObjectInfo } from '@ptp/datasets/object-info-dataset'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { CanonRegistry, createCanonRegistry } from '@ptp/registry'
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
    private remoteModeEnabled = false
    private eventModeEnabled = false
    private eventPollingInterval?: NodeJS.Timeout
    private isPollingPaused = false
    private propertyCache = new Map<number, any>()
    private allowedValuesCache = new Map<number, number[]>()
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
        
        // Flush initial property dump from camera and cache all properties
        await this.flushInitialEvents()
        
        this.startEventPolling()
    }

    async disconnect(): Promise<void> {
        this.stopEventPolling()
        await this.disableRemoteMode()
        await this.disableEventMode()
        await super.disconnect()
    }

    async getAperture(): Promise<string> {
        const rawValue = await this.getCanonProperty(this.registry.properties.CanonAperture.code)
        const codec = this.registry.properties.CanonAperture.codec(this.registry)
        const encoded = this.registry.codecs.uint16.encode(rawValue)
        const decoded = codec.decode(encoded)
        return decoded.value
    }

    async setAperture(value: string): Promise<void> {
        const codec = this.registry.properties.CanonAperture.codec(this.registry)
        const rawValue = this.findRawValueFromString(codec, value)
        if (rawValue === undefined) {
            throw new Error(`Invalid aperture value: ${value}`)
        }
        return this.setCanonProperty(this.registry.properties.CanonAperture.code, rawValue)
    }

    async getShutterSpeed(): Promise<string> {
        const rawValue = await this.getCanonProperty(this.registry.properties.CanonShutterSpeed.code)
        const codec = this.registry.properties.CanonShutterSpeed.codec(this.registry)
        const encoded = this.registry.codecs.uint16.encode(rawValue)
        const decoded = codec.decode(encoded)
        return decoded.value
    }

    async setShutterSpeed(value: string): Promise<void> {
        const codec = this.registry.properties.CanonShutterSpeed.codec(this.registry)
        const rawValue = this.findRawValueFromString(codec, value)
        if (rawValue === undefined) {
            throw new Error(`Invalid shutter speed value: ${value}`)
        }
        return this.setCanonProperty(this.registry.properties.CanonShutterSpeed.code, rawValue)
    }

    async getIso(): Promise<string> {
        const rawValue = await this.getCanonProperty(this.registry.properties.CanonIso.code)
        const codec = this.registry.properties.CanonIso.codec(this.registry)
        const encoded = this.registry.codecs.uint16.encode(rawValue)
        const decoded = codec.decode(encoded)
        return decoded.value
    }

    async setIso(value: string): Promise<void> {
        const codec = this.registry.properties.CanonIso.codec(this.registry)
        const rawValue = this.findRawValueFromString(codec, value)
        if (rawValue === undefined) {
            throw new Error(`Invalid ISO value: ${value}`)
        }
        return this.setCanonProperty(this.registry.properties.CanonIso.code, rawValue)
    }

    private async getCanonProperty(propertyCode: number): Promise<any> {
        // Canon EOS properties are read-only from the event stream cache
        // We never send RequestDevicePropValue - just read from cache
        if (!this.propertyCache.has(propertyCode)) {
            throw new Error(`Property ${propertyCode.toString(16)} not found in cache. The camera may not support this property or event mode is not enabled.`)
        }
        return this.propertyCache.get(propertyCode)
    }

    private async setCanonProperty(propertyCode: number, value: number): Promise<void> {
        const u32Codec = this.registry.codecs.uint32
        const u16Codec = this.registry.codecs.uint16
        
        const totalSize = 12
        
        const data = new Uint8Array(totalSize)
        
        const sizeBytes = u32Codec.encode(totalSize)
        data.set(sizeBytes, 0)
        
        const propCodeBytes = u32Codec.encode(propertyCode)
        data.set(propCodeBytes, 4)
        
        const valueBytes = u16Codec.encode(value)
        data.set(valueBytes, 8)

        this.isPollingPaused = true
        
        try {
            let retries = 0
            const maxRetries = 5
            
            while (retries < maxRetries) {
                try {
                    await this.send(this.registry.operations.CanonSetDevicePropValue, {}, data)
                    return
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
        } finally {
            this.isPollingPaused = false
        }
    }

    private findRawValueFromString(codec: any, searchValue: string): number | undefined {
        if ('getEnumByName' in codec && 'getAllValues' in codec) {
            const byName = codec.getEnumByName(searchValue)
            if (byName) {
                return byName.value
            }
            
            const allValues = codec.getAllValues()
            const byDescription = allValues.find((e: any) => e.description === searchValue)
            if (byDescription) {
                return byDescription.value
            }
        }
        return undefined
    }

    getPropertyAllowedValues(propertyCode: number): string[] | undefined {
        const rawValues = this.allowedValuesCache.get(propertyCode)
        if (!rawValues) {
            return undefined
        }

        const property = Object.values(this.registry.properties).find(p => p.code === propertyCode)
        if (!property) {
            return rawValues.map(v => v.toString())
        }

        try {
            const codec = property.codec(this.registry)
            return rawValues.map(rawValue => {
                const encoded = this.registry.codecs.uint16.encode(rawValue)
                const decoded = codec.decode(encoded)
                return decoded.value
            })
        } catch (error) {
            return rawValues.map(v => v.toString())
        }
    }

    async captureImage({ includeInfo = true, includeData = true }): Promise<{ info?: ObjectInfo; data?: Uint8Array }> {
        await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'FOCUS' })
        await this.send(this.registry.operations.CanonRemoteReleaseOn, { ReleaseMode: 'SHUTTER' })
        await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'SHUTTER' })
        await this.send(this.registry.operations.CanonRemoteReleaseOff, { ReleaseMode: 'FOCUS' })

        return {}
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
                    response.data.forEach(event => {
                        this.handleEvent({
                            code: event.code,
                            parameters: event.parameters.map(p => (typeof p === 'bigint' ? Number(p) : p)),
                            transactionId: 0,
                        })
                        
                        // CanonValueChanged event (0xC189 = 49545)
                        if (event.code === 0xC189 && event.parameters && event.parameters.length >= 2) {
                            const propCode = typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                            const value = typeof event.parameters[1] === 'bigint' ? Number(event.parameters[1]) : event.parameters[1]
                            this.propertyCache.set(propCode, value)
                        }
                        
                        // CanonAllowedValuesChanged event (0xC18A = 49546)
                        if (event.code === 0xC18A) {
                            if (event.parameters && event.parameters.length >= 1) {
                                const propCode = typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                                if (event.allowedValues && event.allowedValues.length > 0) {
                                    this.allowedValuesCache.set(propCode, event.allowedValues)
                                }
                            }
                        }
                    })
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

    private async flushInitialEvents(): Promise<void> {
        // After enabling event mode, camera sends all current property values
        // Cache them so properties are available immediately
        let emptyCount = 0
        const maxEmptyBeforeStop = 3 // Wait for 3 consecutive empty responses
        
        for (let i = 0; i < 20; i++) {
            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                    console.log(`Received ${response.data.length} events during initial flush`)
                    response.data.forEach(event => {
                        console.log(`Event: 0x${event.code.toString(16)} with ${event.parameters?.length || 0} parameters`)
                        
                        // CanonValueChanged event (0xC189 = 49545)
                        if (event.code === 0xC189 && event.parameters && event.parameters.length >= 2) {
                            const propCode = typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                            const value = typeof event.parameters[1] === 'bigint' ? Number(event.parameters[1]) : event.parameters[1]
                            this.propertyCache.set(propCode, value)
                        }
                        
                        // CanonAllowedValuesChanged event (0xC18A = 49546)
                        if (event.code === 0xC18A) {
                            if (event.parameters && event.parameters.length >= 1) {
                                const propCode = typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                                console.log(`  Property: 0x${propCode.toString(16)}, allowedValues: ${event.allowedValues?.length || 0}`)
                                if (event.allowedValues && event.allowedValues.length > 0) {
                                    this.allowedValuesCache.set(propCode, event.allowedValues)
                                }
                            }
                        }
                    })
                    emptyCount = 0
                } else {
                    emptyCount++
                    if (emptyCount >= maxEmptyBeforeStop) {
                        break
                    }
                }
                
                // Small delay between polls
                await new Promise(resolve => setTimeout(resolve, 50))
            } catch (error) {
                break
            }
        }
        
        console.log(`Initial flush complete: ${this.propertyCache.size} properties cached, ${this.allowedValuesCache.size} properties with allowed values`)
    }
}
