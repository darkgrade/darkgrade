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
    private pendingPropertyRequests = new Map<number, Array<(value: any) => void>>()
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
        
        // Flush initial property dump from camera
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

    private async getCanonProperty(propertyCode: number): Promise<any> {
        // Check cache first
        if (this.propertyCache.has(propertyCode)) {
            return this.propertyCache.get(propertyCode)
        }
        
        // Not in cache, request it
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                const callbacks = this.pendingPropertyRequests.get(propertyCode)
                if (callbacks) {
                    const index = callbacks.indexOf(resolve)
                    if (index > -1) {
                        callbacks.splice(index, 1)
                    }
                    if (callbacks.length === 0) {
                        this.pendingPropertyRequests.delete(propertyCode)
                    }
                }
                reject(new Error(`Timeout waiting for property ${propertyCode.toString(16)} value`))
            }, 5000)

            if (!this.pendingPropertyRequests.has(propertyCode)) {
                this.pendingPropertyRequests.set(propertyCode, [])
            }
            
            const wrappedResolve = (value: any) => {
                clearTimeout(timeoutId)
                resolve(value)
            }
            
            this.pendingPropertyRequests.get(propertyCode)!.push(wrappedResolve)

            this.send(this.registry.operations.CanonRequestDevicePropValue, { DevicePropCode: propertyCode }).catch(reject)
        })
    }

    private async setCanonProperty(propertyCode: number, value: number): Promise<void> {
        const codec = this.registry.codecs.uint16
        const propertyCodeBytes = codec.encode(propertyCode)
        const valueBytes = codec.encode(value)

        const data = new Uint8Array(propertyCodeBytes.length + valueBytes.length)
        data.set(propertyCodeBytes, 0)
        data.set(valueBytes, propertyCodeBytes.length)

        await this.send(this.registry.operations.CanonSetPropValue, {}, data)
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
                            
                            const callbacks = this.pendingPropertyRequests.get(propCode)
                            if (callbacks) {
                                callbacks.forEach(cb => cb(value))
                                this.pendingPropertyRequests.delete(propCode)
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
        // We need to poll events to cache them before making property requests
        let emptyCount = 0
        const maxEmptyBeforeStop = 3 // Wait for 3 consecutive empty responses
        
        for (let i = 0; i < 20; i++) {
            try {
                const response = await this.send(this.registry.operations.CanonGetEventData, {}, undefined, 50000)
                if (response.data && Array.isArray(response.data) && response.data.length > 0) {
                    response.data.forEach(event => {
                        // CanonValueChanged event (0xC189 = 49545)
                        if (event.code === 0xC189 && event.parameters && event.parameters.length >= 2) {
                            const propCode = typeof event.parameters[0] === 'bigint' ? Number(event.parameters[0]) : event.parameters[0]
                            const value = typeof event.parameters[1] === 'bigint' ? Number(event.parameters[1]) : event.parameters[1]
                            this.propertyCache.set(propCode, value)
                        }
                    })
                    emptyCount = 0 // Reset counter when we get events
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
    }
}
