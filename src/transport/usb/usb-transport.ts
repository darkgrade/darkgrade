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
 * Queued USB operation
 */
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
    private classRequestHandler: USBClassRequestHandler | null = null
    private readonly deviceFinder: USBDeviceFinder
    private readonly endpointManager: USBEndpointManager

    // Persistent interrupt listener
    private isListeningForEvents = false

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
        console.log('[DEBUG] USBTransport.connect: Starting connection')

        // Clear any stale state from previous connection
        this.isListeningForEvents = false

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
            // Specific device requested - find it in authorized devices
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

        console.log('[DEBUG] USBTransport.connect: About to call connectDevice()')
        await this.connectDevice()

        console.log('[DEBUG] USBTransport.connect: Setting connected=true')
        this.connected = true

        console.log('[DEBUG] USBTransport.connect: Connection complete')

        // Start listening for interrupt events if endpoint exists
        if (this.endpoints.interrupt) {
            console.log('[DEBUG] USBTransport.connect: Starting interrupt event listener')
            this.startListeningForEvents()
        }
    }

    /**
     * Disconnect from the current device
     */
    async disconnect(): Promise<void> {
        console.log('[DEBUG] USBTransport.disconnect: Starting disconnect')
        if (!this.connected) {
            console.log('[DEBUG] USBTransport.disconnect: Not connected, skipping')
            return
        }

        console.log('[DEBUG] USBTransport.disconnect: Stopping event listening')
        await this.stopEventListening()
        console.log('[DEBUG] USBTransport.disconnect: Event listening stopped')

        console.log('[DEBUG] USBTransport.disconnect: Closing device')
        console.log('[DEBUG] USBTransport.disconnect: Device opened:', this.device.opened)

        const closePromise = this.device.close()
        console.log('[DEBUG] USBTransport.disconnect: Close promise created')

        const closeResult = await closePromise
        console.log('[DEBUG] USBTransport.disconnect: Device close result:', closeResult)
        console.log('[DEBUG] USBTransport.disconnect: Device closed')

        this.device = null
        this.interface = null
        this.endpoints = null
        this.connected = false
        this.eventHandlers.clear()
        this.classRequestHandler = null
        console.log('[DEBUG] USBTransport.disconnect: Disconnect complete')
    }

    async send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        return this.bulkOut(data, sessionId, transactionId)
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        return this.bulkIn(maxLength, sessionId, transactionId)
    }

    private async bulkOut(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const buffer = toBuffer(data)
        const endpointAddress = this.endpoints.bulkOut.endpointNumber

        const container = USBContainerBuilder.parseContainer(data)

        console.log(
            `[DEBUG] bulkOut: About to call device.transferOut(endpoint=0x${endpointAddress.toString(16)}, bytes=${buffer.length})`
        )
        console.log(
            `[DEBUG] bulkOut: sessionId=${sessionId}, transactionId=${transactionId}, containerType=${container.type}`
        )

        this.logger.addLog({
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

        // Do transfer - USB layer handles NAKs automatically
        let result = await this.device.transferOut(endpointAddress, buffer)

        console.log(`[DEBUG] bulkOut: device.transferOut returned with status=${result.status}`)

        // Handle STALL per PIMA 15740 Figure 4 (Host behavior)
        if (result.status === 'stall') {
            console.log('[STALL] bulkOut: Endpoint stalled, following PTP spec recovery procedure')
            console.log('[STALL] Step 1: Get device status to determine stalled endpoints')
            await this.handleStallError(EndpointType.BULK_OUT)
            console.log('[STALL] Step 2: Retry transfer after clearing halt')
            result = await this.device.transferOut(endpointAddress, buffer)
            console.log(`[STALL] bulkOut: Retry result status=${result.status}`)
        }

        if (result.status !== 'ok') {
            throw new Error(`Bulk OUT failed: ${result.status}`)
        }
    }

    /**
     * Bulk IN transfer - per PIMA 15740 spec
     * USB layer handles NAKs automatically, we only handle STALL
     * @param maxLength - Maximum length to receive
     * @param sessionId - Session ID for logging
     * @param transactionId - Transaction ID for logging
     * @returns Received data
     */
    private async bulkIn(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const endpointAddr = this.endpoints.bulkIn.endpointNumber

        console.log(
            `[DEBUG] bulkIn: About to call device.transferIn(endpoint=0x${endpointAddr.toString(16)}, maxLength=${maxLength})`
        )
        console.log(`[DEBUG] bulkIn: sessionId=${sessionId}, transactionId=${transactionId}`)

        // Do transfer with 5 second timeout
        const transfer = this.device.transferIn(endpointAddr, maxLength)
        const timeout = new Promise<USBInTransferResult>((_, reject) => {
            setTimeout(
                () => reject(new Error(`BulkIn timeout after 5s (endpoint 0x${endpointAddr.toString(16)})`)),
                5000
            )
        })

        let result = await Promise.race([transfer, timeout])

        console.log(`[DEBUG] bulkIn: device.transferIn returned with status=${result.status}`)

        // Handle STALL per PIMA 15740 Figure 4 (Host behavior)
        if (result.status === 'stall') {
            console.log('[STALL] bulkIn: Endpoint stalled, following PTP spec recovery procedure')
            console.log('[STALL] Step 1: Get device status to determine stalled endpoints')
            await this.handleStallError(EndpointType.BULK_IN)
            console.log('[STALL] Step 2: Retry transfer after clearing halt')
            result = await this.device.transferIn(endpointAddr, maxLength)
            console.log(`[STALL] bulkIn: Retry result status=${result.status}`)
        }

        if (result.status !== 'ok' || !result.data || result.data.byteLength === 0) {
            throw new Error(`Bulk IN failed: ${result.status}`)
        }

        const data = toUint8Array(result.data.buffer as ArrayBuffer)
        const container = USBContainerBuilder.parseContainer(data)

        this.logger.addLog({
            type: 'usb_transfer',
            level: 'info',
            direction: 'receive',
            bytes: data.length,
            endpoint: 'bulkIn',
            endpointAddress: `0x${endpointAddr.toString(16)}`,
            sessionId: sessionId,
            transactionId: transactionId,
            phase: container.type === 1 ? 'request' : container.type === 2 ? 'data' : 'response',
        })

        return data
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
        console.log('[DEBUG] connectDevice: Opening device')
        await this.device.open()
        console.log('[DEBUG] connectDevice: Device opened')
        console.log('[DEBUG] connectDevice: Device type:', this.device.constructor.name)
        console.log('[DEBUG] connectDevice: Device keys:', Object.keys(this.device))

        console.log('[DEBUG] connectDevice: Configuring endpoints')
        // Configure endpoints (this also claims the interface)
        const config = await this.endpointManager.configureEndpoints(this.device)
        this.endpoints = config
        console.log('[DEBUG] connectDevice: Endpoints configured')
        console.log('[DEBUG] connectDevice: Interrupt endpoint type:', this.endpoints.interrupt?.constructor.name)
        console.log(
            '[DEBUG] connectDevice: Interrupt endpoint keys:',
            this.endpoints.interrupt ? Object.keys(this.endpoints.interrupt) : 'none'
        )
        console.log('[DEBUG] connectDevice: Device has native device?', (this.device as any).device ? 'yes' : 'no')
        if ((this.device as any).device) {
            console.log('[DEBUG] connectDevice: Native device type:', (this.device as any).device.constructor.name)
            console.log('[DEBUG] connectDevice: Native device keys:', Object.keys((this.device as any).device))
        }

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

        if (this.endpoints.interrupt) {
            console.log(
                `[DEBUG] connectDevice: Interrupt endpoint found on 0x${this.endpoints.interrupt.endpointNumber.toString(16)}`
            )
        } else {
            console.log('[DEBUG] connectDevice: No interrupt endpoint found')
        }
    }

    /**
     * Handle STALL per PIMA 15740 section D.7.2.1
     *
     * Device-initiated cancel procedure:
     * 1. Get device status to determine which endpoints are stalled
     * 2. Clear halt on stalled endpoints
     * 3. Poll device status until OK (0x2001)
     */
    private async handleStallError(endpointType: EndpointType): Promise<void> {
        console.log(`[STALL] handleStallError: Endpoint type=${endpointType}`)

        if (!this.classRequestHandler) {
            throw new Error('Cannot handle STALL without class request handler')
        }

        // Step 1: Get device status (per PIMA 15740 Figure 4)
        console.log('[STALL] Step 1: Calling Get_Device_Status')
        const initialStatus = await this.classRequestHandler.getDeviceStatus()
        console.log(
            `[STALL] Device status: code=0x${initialStatus.code.toString(16)}, length=${initialStatus.length}, params=${JSON.stringify(initialStatus.parameters)}`
        )

        // Step 2: Clear halt on affected endpoints
        console.log('[STALL] Step 2: Clearing halt on endpoints')
        if (endpointType === EndpointType.BULK_IN || endpointType === EndpointType.BULK_OUT) {
            // Clear both bulk endpoints (device may stall both per spec)
            console.log(`[STALL] Clearing halt on bulkIn endpoint ${this.endpoints.bulkIn.endpointNumber}`)
            await this.device.clearHalt('in', this.endpoints.bulkIn.endpointNumber)
            console.log(`[STALL] Clearing halt on bulkOut endpoint ${this.endpoints.bulkOut.endpointNumber}`)
            await this.device.clearHalt('out', this.endpoints.bulkOut.endpointNumber)
        } else if (endpointType === EndpointType.INTERRUPT && this.endpoints.interrupt) {
            // Clear interrupt endpoint
            console.log(`[STALL] Clearing halt on interrupt endpoint ${this.endpoints.interrupt.endpointNumber}`)
            await this.device.clearHalt('in', this.endpoints.interrupt.endpointNumber)
        }

        // Step 3: Poll status until device returns OK (0x2001)
        console.log('[STALL] Step 3: Polling device status until OK (0x2001)')
        for (let i = 0; i < 10; i++) {
            const status = await this.classRequestHandler.getDeviceStatus()
            console.log(`[STALL] Poll ${i + 1}/10: status code=0x${status.code.toString(16)}`)
            if (status.code === 0x2001) {
                return
            }
            await new Promise(resolve => setTimeout(resolve, 50))
        }

        throw new Error('Device did not return OK after STALL recovery')
    }

    onEvent(handler: (event: PTPEvent) => void): void {
        this.eventHandlers.add(handler)
    }

    offEvent(handler: (event: PTPEvent) => void): void {
        this.eventHandlers.delete(handler)
    }

    /**
     * Stop listening for interrupt events
     * Uses clearHalt to force pending interrupt transfer to complete before device close
     */
    async stopEventListening(): Promise<void> {
        console.log('[DEBUG] stopEventListening: Stopping event listener')
        this.isListeningForEvents = false

        // If there's an interrupt endpoint, try to force any pending transfer to complete
        // This prevents segfaults when closing the device with a pending transfer
        if (this.endpoints?.interrupt && this.device) {
            console.log(
                '[DEBUG] stopEventListening: Calling clearHalt on interrupt endpoint to cancel pending transfer'
            )
            try {
                await this.device.clearHalt('in', this.endpoints.interrupt.endpointNumber)
                console.log('[DEBUG] stopEventListening: clearHalt completed')
            } catch (error: any) {
                console.log('[DEBUG] stopEventListening: clearHalt error (expected):', error?.message || error)
            }

            // Brief wait to let the transfer promise resolve/reject
            await new Promise(resolve => setTimeout(resolve, 100))
            console.log('[DEBUG] stopEventListening: Wait complete, pending transfer should have resolved')
        }
    }

    /**
     * Start listening for interrupt events
     * Kicks off ONE interrupt transfer that hangs until an event arrives
     * When it completes/fails, immediately starts another one
     */
    private startListeningForEvents(): void {
        if (!this.connected || !this.endpoints?.interrupt || this.isListeningForEvents) {
            return
        }

        this.isListeningForEvents = true

        console.log('[INTERRUPT] Starting persistent interrupt listener')

        // Kick off the interrupt transfer - don't await it
        const transfer = this.device.transferIn(
            this.endpoints.interrupt.endpointNumber,
            64 // Max packet size for interrupt endpoint
        )

        // Attach promise handlers
        transfer
            .then((result: USBInTransferResult) => {
                console.log(
                    `[INTERRUPT] Transfer completed with status=${result.status}, hasData=${!!(result.data && result.data.byteLength > 0)}`
                )

                if (result.status === 'stall') {
                    console.log('[INTERRUPT] Endpoint stalled - following PTP recovery procedure')
                    this.handleStallError(EndpointType.INTERRUPT).then(() => {
                        // After clearing stall, restart listening if still connected
                        if (this.isListeningForEvents) {
                            console.log('[INTERRUPT] Restarting listener after stall recovery')
                            this.isListeningForEvents = false
                            this.startListeningForEvents()
                        }
                    })
                } else if (result.status === 'ok' && result.data && result.data.byteLength > 0) {
                    console.log(`[INTERRUPT] Received ${result.data.byteLength} bytes of event data`)
                    const data = new Uint8Array(result.data.buffer)
                    this.handleInterruptData(data)

                    // Immediately start listening again
                    if (this.isListeningForEvents) {
                        this.isListeningForEvents = false
                        this.startListeningForEvents()
                    }
                } else {
                    console.log(`[INTERRUPT] Transfer completed with status=${result.status} but no data`)

                    // Restart listening
                    if (this.isListeningForEvents) {
                        this.isListeningForEvents = false
                        this.startListeningForEvents()
                    }
                }
            })
            .catch((error: any) => {
                if (error.message.includes('LIBUSB_TRANSFER_CANCELLED')) {
                    console.log('[INTERRUPT] Transfer cancelled (OK)')
                    return
                }
                console.log(`[INTERRUPT] Transfer failed: ${error.message}, ${error.code}`)

                // If still connected, restart listening after a brief delay
                if (this.isListeningForEvents) {
                    setTimeout(() => {
                        if (this.isListeningForEvents) {
                            this.isListeningForEvents = false
                            this.startListeningForEvents()
                        }
                    }, 100)
                }
            })

        console.log('[INTERRUPT] Listener started - will remain active until stopEventListening() called')
    }

    private handleInterruptData(data: Uint8Array): void {
        console.log(`[DEBUG] handleInterruptData: Received ${data.length} bytes`)
        const eventContainer = USBContainerBuilder.parseEvent(data)
        console.log(`[DEBUG] handleInterruptData: Parsed event container, code=0x${eventContainer.code.toString(16)}`)

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
            handler(event)
        })
    }
}
