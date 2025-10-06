import { TransportInterface, PTPEvent } from '@transport/interfaces/transport.interface'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { Logger } from '@core/logger'
import { OperationDefinition } from '@ptp/types/operation'
import { USBClassRequestHandler } from './usb-class-requests'
import { USBContainerBuilder, USBContainerType } from './usb-container'
import { USBDeviceFinder } from './usb-device-finder'
import { USBEndpointManager } from './usb-endpoint-manager'
import { EndpointType } from './endpoint.interface'

/**
 * USB-specific limits
 */
export const USB_LIMITS = {
    /** Maximum USB transfer size (1GB for large file transfers) */
    MAX_USB_TRANSFER: 1024 * 1024 * 1024,
    /** Default USB receive timeout in milliseconds */
    RECEIVE_TIMEOUT: 5000,
    /** Default bulk transfer size */
    DEFAULT_BULK_SIZE: 8192,
} as const

/**
 * Convert Uint8Array to Buffer
 * @param data - Uint8Array to convert
 * @returns Buffer
 */
export function toBuffer(data: Uint8Array): Buffer {
    return Buffer.from(data)
}

/**
 * Convert Buffer or any array-like to Uint8Array
 * @param data - Buffer or array-like to convert
 * @returns Uint8Array
 */
export function toUint8Array(data: Buffer | ArrayBuffer | ArrayLike<number>): Uint8Array {
    if (data instanceof Uint8Array) {
        return data
    }
    return new Uint8Array(data)
}

/**
 * USB transport implementation for PTP communication
 */
export class USBTransport implements TransportInterface {
    private device: any = null
    private interface: any = null
    private endpoints: any = null
    private connected = false
    private deviceInfo: { vendorId: number; productId: number } | null = null
    private eventHandlers: Set<(event: PTPEvent) => void> = new Set()
    private interruptListening = false
    private interruptInterval: any = null
    private classRequestHandler: USBClassRequestHandler | null = null
    private transactionId = 0
    private readonly deviceFinder: USBDeviceFinder
    private readonly endpointManager: USBEndpointManager

    constructor(logger: Logger<any>) {
        this.logger = logger
        this.deviceFinder = new USBDeviceFinder()
        this.endpointManager = new USBEndpointManager()
    }

    private logger: Logger<any>

    /**
     * Discover available USB devices
     */
    async discover(): Promise<DeviceDescriptor[]> {
        return await this.deviceFinder.findDevices({ class: 6 })
    }

    /**
     * Connect to a USB device
     * @param deviceIdentifier - Optional device descriptor. If not provided, discovers and connects to first available device.
     */
    async connect(deviceIdentifier?: DeviceDescriptor): Promise<void> {
        if (this.connected) {
            throw new Error('Already connected')
        }

        let device: any = null

        if (!deviceIdentifier) {
            // No specific device requested - prompt user to select one
            device = await this.deviceFinder.requestDevice({
                vendorId: undefined,
                productId: undefined,
                class: 6,
            })
        } else if (deviceIdentifier.vendorId === 0) {
            // Auto-discovery requested
            device = await this.deviceFinder.requestDevice({
                vendorId: undefined,
                productId: undefined,
                class: 6,
            })
        } else {
            // Specific device requested - try to find it in authorized devices
            const devices = await this.deviceFinder.findDevices({
                vendorId: deviceIdentifier.vendorId,
                productId: deviceIdentifier.productId,
                class: 6,
            })

            device = devices.find(d => {
                if (deviceIdentifier.serialNumber) {
                    return d.serialNumber === deviceIdentifier.serialNumber
                }
                return true
            })

            if (!device) {
                // Not found in authorized devices, request access
                device = await this.deviceFinder.requestDevice({
                    vendorId: deviceIdentifier.vendorId,
                    productId: deviceIdentifier.productId,
                })
            }
        }

        if (!device) {
            const idStr = deviceIdentifier
                ? `${deviceIdentifier.vendorId}:${deviceIdentifier.productId}`
                : 'matching criteria'
            throw new Error(`Device not found: ${idStr}`)
        }

        this.device = device.device
        this.deviceInfo = { vendorId: device.vendorId, productId: device.productId }

        await this.connectDevice()

        this.connected = true
    }

    /**
     * Disconnect from the current device
     */
    async disconnect(): Promise<void> {
        if (!this.connected) {
            return
        }

        try {
            await this.stopEventListening()
        } catch (e) {
            // Ignore event listening errors during disconnect
        }

        try {
            if (this.interface) {
                await this.device.releaseInterface(this.interface.interfaceNumber)
            }
        } catch (e) {
            // Ignore interface release errors
        }

        try {
            await this.device.close()
        } catch (e) {
            // Ignore device close errors
        }

        this.device = null
        this.interface = null
        this.endpoints = null
        this.connected = false
        this.eventHandlers.clear()
        this.classRequestHandler = null
    }

    /**
     * Drain any pending data from the device by reading until timeout
     * This clears stale data from previous failed sessions
     * @returns true if stale data was found, false otherwise
     */
    async drainPendingData(): Promise<boolean> {
        if (!this.connected || !this.endpoints) {
            return false
        }

        // Try to read with a very short timeout - if there's pending data we'll get it
        // If not, timeout quickly and continue
        try {
            const data = await Promise.race([
                this.bulkIn(512),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error('No pending data')), 50)
                )
            ])
            if (data && data.length > 0) {
                // Drained stale data from device
                return true
            }
        } catch (e) {
            // No data to drain, which is normal
        }
        return false
    }

    private getNextTransactionId(): number {
        this.transactionId = (this.transactionId + 1) & 0xffffffff
        return this.transactionId
    }

    async send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        await this.bulkOut(data, sessionId, transactionId)
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        return await this.bulkIn(maxLength, sessionId, transactionId)
    }

    private async bulkOut(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const buffer = toBuffer(data)
        const endpointAddress = this.endpoints.bulkOut.endpointNumber

        const container = USBContainerBuilder.parseContainer(data)
        const containerTypeNames = ['', 'COMMAND', 'DATA', 'RESPONSE', 'EVENT']
        const containerTypeName = containerTypeNames[container.type] || `Unknown(${container.type})`
        const containerInfo = `[${containerTypeName}, Code: 0x${container.code.toString(16)}, TxID: ${container.transactionId}]`

        const transferId = this.logger.addLog({
            type: 'usb_transfer',
            level: 'info',
            direction: 'send',
            bytes: buffer.length,
            endpoint: 'bulkOut',
            endpointAddress: `0x${endpointAddress.toString(16)}`,
            sessionId: sessionId,
            transactionId: transactionId,
            phase: container.type === 1 ? 'request' : container.type === 2 ? 'data' : 'response',
        })

        try {
            const result = await this.device.transferOut(this.endpoints.bulkOut.endpointNumber, buffer)
            if (result.status !== 'ok') {
                throw new Error(`Transfer failed: ${result.status}`)
            }
        } catch (error) {
            throw error
        }
    }

    private async bulkIn(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const endpointAddr = this.endpoints.bulkIn.endpointNumber
        const CHUNK_SIZE = 64 * 1024 // 64KB chunks

        try {
            // Read first chunk to get container header and determine total length
            const firstResult = await this.device.transferIn(this.endpoints.bulkIn.endpointNumber, CHUNK_SIZE)

            if (firstResult.status !== 'ok') {
                throw new Error(`Transfer failed: ${firstResult.status}`)
            }

            const firstChunk = toUint8Array(firstResult.data.buffer)

            // Parse container header to get total expected length
            if (firstChunk.length < 12) {
                throw new Error('Container too short')
            }

            const view = new DataView(firstChunk.buffer, firstChunk.byteOffset, firstChunk.byteLength)
            const containerLength = view.getUint32(0, true) // little-endian

            // If this is a small container (command/response), we likely got it all
            if (firstChunk.length >= containerLength) {
                const container = USBContainerBuilder.parseContainer(firstChunk)

                this.logger.addLog({
                    type: 'usb_transfer',
                    level: 'info',
                    direction: 'receive',
                    bytes: firstChunk.length,
                    endpoint: 'bulkIn',
                    endpointAddress: `0x${endpointAddr.toString(16)}`,
                    sessionId: sessionId,
                    transactionId: transactionId,
                    phase: container.type === 1 ? 'request' : container.type === 2 ? 'data' : 'response',
                })

                return firstChunk.slice(0, containerLength)
            }

            // Large transfer - read remaining data in chunks
            const chunks: Uint8Array[] = [firstChunk]
            let totalReceived = firstChunk.length

            while (totalReceived < containerLength) {
                const remaining = containerLength - totalReceived
                const nextChunkSize = Math.min(remaining, CHUNK_SIZE)

                const result = await this.device.transferIn(this.endpoints.bulkIn.endpointNumber, nextChunkSize)

                if (result.status !== 'ok') {
                    throw new Error(`Transfer failed: ${result.status}`)
                }

                const chunk = toUint8Array(result.data.buffer)

                if (chunk.length === 0) {
                    // No more data available
                    break
                }

                chunks.push(chunk)
                totalReceived += chunk.length
            }

            // Combine all chunks into final buffer
            const completeData = new Uint8Array(totalReceived)
            let offset = 0
            for (const chunk of chunks) {
                completeData.set(chunk, offset)
                offset += chunk.length
            }

            const container = USBContainerBuilder.parseContainer(completeData)

            this.logger.addLog({
                type: 'usb_transfer',
                level: 'info',
                direction: 'receive',
                bytes: completeData.length,
                endpoint: 'bulkIn',
                endpointAddress: `0x${endpointAddr.toString(16)}`,
                sessionId: sessionId,
                transactionId: transactionId,
                phase: container.type === 1 ? 'request' : container.type === 2 ? 'data' : 'response',
            })

            return completeData.slice(0, Math.min(containerLength, completeData.length))
        } catch (error) {
            throw error
        }
    }

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected
    }

    /**
     * Reset the USB device
     */
    async reset(): Promise<void> {
        if (!this.connected || !this.device) {
            throw new Error('Not connected')
        }

        if (this.classRequestHandler) {
            await this.classRequestHandler.deviceReset()
        }
    }

    async cancelRequest(transactionId: number): Promise<void> {
        if (!this.classRequestHandler) {
            throw new Error('USB class request handler not available')
        }
        await this.classRequestHandler.cancelRequest(transactionId)
    }

    async getDeviceStatus(): Promise<any> {
        if (!this.classRequestHandler) {
            throw new Error('USB class request handler not available')
        }
        return await this.classRequestHandler.getDeviceStatus()
    }

    async getExtendedEventData(bufferSize?: number): Promise<any> {
        if (!this.classRequestHandler) {
            throw new Error('USB class request handler not available')
        }
        return await this.classRequestHandler.getExtendedEventData(bufferSize)
    }

    /**
     * Get transport type
     */
    getType(): TransportType {
        return TransportType.USB
    }

    /**
     * Get endianness for USB transport
     * USB uses little-endian per PIMA 15740 specification
     */
    isLittleEndian(): boolean {
        return true
    }

    /**
     * Get connected device information
     */
    getDeviceInfo(): DeviceDescriptor | null {
        return this.deviceInfo
    }

    private async connectDevice(): Promise<void> {
        await this.device.open()

        // Configure endpoints (this also claims the interface)
        const config = await this.endpointManager.configureEndpoints(this.device)
        this.endpoints = config

        // Find PTP interface from configuration
        const configuration = this.device.configuration || this.device.configurations?.[0]
        if (configuration) {
            for (const intf of configuration.interfaces) {
                const alt = intf.alternates?.[0] || intf.alternate
                if (alt && alt.interfaceClass === 6 && alt.interfaceSubclass === 1) {
                    this.interface = intf
                    this.classRequestHandler = new USBClassRequestHandler(this.device, intf.interfaceNumber)
                    break
                }
            }
        }

        if (!this.interface) {
            throw new Error('Failed to find PTP interface')
        }

        // Start event listening immediately if interrupt endpoint is available
        // Camera may send events that need to be polled before it can proceed
        if (this.endpoints.interrupt) {
            await this.startEventListening()
        }
    }


    /**
     * Handle stall error by clearing halt and polling device status
     */
    private async handleStallError(endpointType: EndpointType): Promise<void> {
        if (this.classRequestHandler) {
            const status = await this.classRequestHandler.getDeviceStatus()

            // Stall detected
        }

        // Clear halt on the appropriate endpoint
        const endpointNumber = endpointType === EndpointType.BULK_IN
            ? this.endpoints.bulkIn.endpointNumber
            : this.endpoints.bulkOut.endpointNumber

        try {
            await this.device.clearHalt('in', endpointNumber)
        } catch (error) {
            // Failed to clear halt
        }

        if (this.classRequestHandler) {
            let retries = 5
            while (retries > 0) {
                const status = await this.classRequestHandler.getDeviceStatus()
                if (status.code === 0x2001) {
                    break
                }
                await new Promise(resolve => setTimeout(resolve, 100))
                retries--
            }
        }
    }

    onEvent(handler: (event: PTPEvent) => void): void {
        this.eventHandlers.add(handler)

        if (this.eventHandlers.size === 1 && this.connected) {
            this.startEventListening().catch(error => {
                // Failed to start event listening
            })
        }
    }

    offEvent(handler: (event: PTPEvent) => void): void {
        this.eventHandlers.delete(handler)

        if (this.eventHandlers.size === 0) {
            this.stopEventListening().catch(error => {
                // Failed to stop event listening
            })
        }
    }

    async startEventListening(): Promise<void> {
        if (this.interruptListening || !this.connected || !this.endpoints?.interrupt) {
            return
        }

        this.interruptListening = true

        this.pollInterruptEndpoint()
    }

    async stopEventListening(): Promise<void> {
        this.interruptListening = false

        if (this.interruptInterval) {
            clearTimeout(this.interruptInterval)
            this.interruptInterval = null
        }
    }

    /**
     * Poll interrupt endpoint
     */
    private async pollInterruptEndpoint(): Promise<void> {
        if (!this.interruptListening || !this.endpoints?.interrupt) {
            return
        }

        try {
            const result = await this.device.transferIn(
                this.endpoints.interrupt.endpointNumber,
                64 // Max packet size for interrupt endpoint
            )

            if (result.status === 'ok' && result.data) {
                const data = new Uint8Array(result.data.buffer)
                this.handleInterruptData(data)
            }
        } catch (error) {
            // Interrupt endpoint error (ignore)
        }

        // Continue polling if still listening
        if (this.interruptListening) {
            this.interruptInterval = setTimeout(() => {
                this.pollInterruptEndpoint()
            }, 100) // Poll every 100ms
        }
    }

    private handleInterruptData(data: Uint8Array): void {
        try {
            const eventContainer = USBContainerBuilder.parseEvent(data)

            const event: PTPEvent = {
                code: eventContainer.code,
                transactionId: eventContainer.transactionId,
                parameters: [],
            }

            const view = new DataView(
                eventContainer.payload.buffer,
                eventContainer.payload.byteOffset,
                eventContainer.payload.byteLength
            )

            let offset = 0
            while (offset + 4 <= eventContainer.payload.length && event.parameters.length < 5) {
                event.parameters.push(view.getUint32(offset, true))
                offset += 4
            }

            this.logger.addLog({
                type: 'usb_transfer',
                level: 'info',
                bytes: data.length,
                direction: 'receive',
                endpoint: 'interrupt',
                endpointAddress: `0x${this.endpoints.interrupt.endpointNumber.toString(16)}`,
                sessionId: event.transactionId >> 16,
                transactionId: event.transactionId,
                phase: 'response',
            })

            this.eventHandlers.forEach(handler => {
                try {
                    handler(event)
                } catch (error) {
                    // Event handler error (ignore)
                }
            })
        } catch (error) {
            // Failed to parse event (ignore)
        }
    }
}
