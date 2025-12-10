import { Logger } from '@core/logger'
import { VendorIDs } from '@ptp/definitions/vendor-ids'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { USBContainerBuilder, USBContainerType } from './usb-container'

export enum EndpointType {
    BULK_IN = 'bulk_in',
    BULK_OUT = 'bulk_out',
    INTERRUPT = 'interrupt',
}

export interface EndpointConfiguration {
    bulkIn: USBEndpoint
    bulkOut: USBEndpoint
    interrupt?: USBEndpoint
}

enum USBClassRequest {
    CANCEL_REQUEST = 0x64,
    GET_EXTENDED_EVENT_DATA = 0x65,
    DEVICE_RESET = 0x66,
    GET_DEVICE_STATUS = 0x67,
}

export interface DeviceStatus {
    code: number
    parameters: number[]
}
export interface ExtendedEventData {
    eventCode: number
    transactionId: number
    parameters: Array<{ size: number; value: Uint8Array }>
}

const USB_CLASS_STILL_IMAGE = 6
const USB_SUBCLASS_STILL_IMAGE_CAPTURE = 1

export const USB_LIMITS = { MAX_USB_TRANSFER: 1024 * 1024 * 1024, DEFAULT_BULK_SIZE: 8192 } as const

export class USBTransport implements TransportInterface {
    private device: USBDevice | null = null
    private interfaceNumber = 0
    private endpoints: EndpointConfiguration | null = null
    private connected = false
    private deviceInfo: { vendorId: number; productId: number } | null = null
    private eventHandlers = new Set<(event: PTPEvent) => void>()
    private usb: USB | null = null
    private isListeningForEvents = false

    constructor(private logger: Logger) {}

    private async getUSB(): Promise<USB> {
        if (this.usb) return this.usb
        this.usb = typeof navigator !== 'undefined' && 'usb' in navigator ? navigator.usb : (await import('usb')).webusb
        return this.usb
    }

    async discover(criteria?: Partial<DeviceDescriptor>): Promise<DeviceDescriptor[]> {
        const devices = await (await this.getUSB()).getDevices()
        return devices
            .filter(
                device =>
                    device.vendorId !== 0 &&
                    (!criteria?.vendorId || criteria.vendorId === 0 || device.vendorId === criteria.vendorId) &&
                    (!criteria?.productId || criteria.productId === 0 || device.productId === criteria.productId) &&
                    (!criteria?.serialNumber || device.serialNumber === criteria.serialNumber)
            )
            .map(device => ({
                device: device,
                vendorId: device.vendorId,
                productId: device.productId,
                manufacturer: device.manufacturerName || undefined,
                model: device.productName || undefined,
                serialNumber: device.serialNumber || undefined,
            }))
    }

    async connect(id?: DeviceDescriptor): Promise<void> {
        if (this.connected) throw new Error('Already connected')

        console.log('[USB] Starting connection...')
        this.isListeningForEvents = false
        const usb = await this.getUSB()

        let usbDevice: USBDevice | undefined =
            id?.vendorId && id.vendorId !== 0 ? (await this.discover(id))[0]?.device : undefined

        if (!usbDevice) {
            console.log('[USB] Requesting device...')
            const filters =
                id?.vendorId && id.vendorId !== 0
                    ? [
                          {
                              vendorId: id.vendorId,
                              ...(id.productId && id.productId !== 0 && { productId: id.productId }),
                          },
                      ]
                    : Object.values(VendorIDs).map(vendorId => ({ vendorId }))
            usbDevice = await usb.requestDevice({ filters })
        }

        this.device = usbDevice
        this.deviceInfo = { vendorId: usbDevice.vendorId, productId: usbDevice.productId }
        console.log(
            `[USB] Opening device (vendor: 0x${usbDevice.vendorId.toString(16)}, product: 0x${usbDevice.productId.toString(16)})`
        )
        await usbDevice.open()
        console.log('[USB] Device opened')

        const config = usbDevice.configuration || usbDevice.configurations?.[0]
        if (!config) throw new Error('No USB configuration')

        const usbInterface = config.interfaces.find(iface => {
            const alternate = iface.alternates?.[0] || iface.alternate
            return (
                alternate?.interfaceClass === USB_CLASS_STILL_IMAGE &&
                alternate?.interfaceSubclass === USB_SUBCLASS_STILL_IMAGE_CAPTURE
            )
        })
        if (!usbInterface) throw new Error('PTP interface not found')

        this.interfaceNumber = usbInterface.interfaceNumber
        console.log(`[USB] Claiming interface ${this.interfaceNumber}`)
        await usbDevice.claimInterface(this.interfaceNumber)
        console.log('[USB] Interface claimed')

        const alternate = usbInterface.alternates?.[0] || usbInterface.alternate
        if (!alternate) throw new Error('No alternate interface')

        const bulkIn = alternate.endpoints.find(endpoint => endpoint.direction === 'in' && endpoint.type === 'bulk')
        const bulkOut = alternate.endpoints.find(endpoint => endpoint.direction === 'out' && endpoint.type === 'bulk')
        const interrupt = alternate.endpoints.find(
            endpoint => endpoint.direction === 'in' && endpoint.type === 'interrupt'
        )

        if (!bulkIn || !bulkOut) throw new Error('Bulk endpoints not found')

        this.endpoints = { bulkIn, bulkOut, interrupt }
        this.connected = true
        console.log(
            `[USB] Connected successfully (bulkIn: 0x${bulkIn.endpointNumber.toString(16)}, bulkOut: 0x${bulkOut.endpointNumber.toString(16)}, interrupt: ${interrupt ? '0x' + interrupt.endpointNumber.toString(16) : 'none'})`
        )

        // Check device status and clear stalls if needed
        try {
            const status = await this.getDeviceStatus()
            console.log(`[USB] Device status: 0x${status.code.toString(16)}`)
            // if (status.code !== 0x2001) {
            await this.device.reset()
            console.log('[USB] Device in stalled state, attempting recovery...')
            await this.device.clearHalt('in', bulkIn.endpointNumber)
            await this.device.clearHalt('out', bulkOut.endpointNumber)
            if (interrupt) {
                await this.device.clearHalt('in', interrupt.endpointNumber)
            }
            await new Promise(resolve => setTimeout(resolve, 100))
            console.log('[USB] Recovery complete')
            await this.device.reset()
            // }
        } catch (error) {
            console.log('[USB] Status check failed (device may be fine):', error)
        }

        // Give device time to settle after interface claim
        console.log('[USB] Waiting for device to be ready for commands...')
        await new Promise(resolve => setTimeout(resolve, 300))
        console.log('[USB] Device ready')

        if (interrupt) this.startListeningForEvents()
    }

    async prepareForDisconnect(): Promise<void> {
        if (!this.connected) return

        console.log('[USB] Preparing for disconnect...')
        // Stop listening for events cleanly
        this.isListeningForEvents = false

        // Wait for flag to propagate
        await new Promise(resolve => setTimeout(resolve, 100))

        // Cancel pending interrupt transfer by clearing halt
        if (this.endpoints?.interrupt && this.device) {
            try {
                console.log(
                    `[USB] Clearing halt on interrupt endpoint 0x${this.endpoints.interrupt.endpointNumber.toString(16)}`
                )
                await this.device.clearHalt('in', this.endpoints.interrupt.endpointNumber)
                // Wait for cancelled transfer to be processed
                await new Promise(resolve => setTimeout(resolve, 100))
                console.log('[USB] Interrupt endpoint cleared')
            } catch (error) {
                console.log('[USB] clearHalt failed (this is often normal):', error)
            }
        }
        console.log('[USB] Prepare complete')
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return

        console.log('[USB] Disconnecting...')
        // Release the claimed interface before closing
        if (this.device && this.interfaceNumber !== 0) {
            try {
                console.log(`[USB] Releasing interface ${this.interfaceNumber}`)
                await this.device.releaseInterface(this.interfaceNumber)
                console.log('[USB] Interface released')
            } catch (error) {
                console.log('[USB] releaseInterface failed:', error)
            }
        }

        if (this.device) {
            console.log('[USB] Closing device...')
            await this.device.close()
            console.log('[USB] Device closed')
        }
        this.device = null
        this.interfaceNumber = 0
        this.endpoints = null
        this.connected = false
        this.eventHandlers.clear()
    }

    async send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        if (!this.connected || !this.endpoints || !this.device) throw new Error('Not connected')

        const endpoint = this.endpoints.bulkOut.endpointNumber
        const container = USBContainerBuilder.parseContainer(data)

        this.logger.addLog({
            type: 'usb_transfer',
            level: 'info',
            direction: 'send',
            bytes: data.length,
            endpoint: 'bulkOut',
            endpointAddress: `0x${endpoint.toString(16)}`,
            sessionId: sessionId,
            transactionId: transactionId,
            phase:
                container.type === USBContainerType.COMMAND
                    ? 'request'
                    : container.type === USBContainerType.DATA
                      ? 'data'
                      : 'response',
        })

        let result = await this.device.transferOut(endpoint, Uint8Array.from(data))
        if (result.status === 'stall') {
            await this.clearStall(EndpointType.BULK_OUT)
            result = await this.device.transferOut(endpoint, Uint8Array.from(data))
        }
        if (result.status !== 'ok') throw new Error(`Bulk OUT failed: ${result.status}`)
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints || !this.device) throw new Error('Not connected')

        const endpoint = this.endpoints.bulkIn.endpointNumber
        let result = await this.device.transferIn(endpoint, maxLength)

        if (result.status === 'stall') {
            await this.clearStall(EndpointType.BULK_IN)
            result = await this.device.transferIn(endpoint, maxLength)
        }

        if (result.status !== 'ok' || !result.data || result.data.byteLength === 0)
            throw new Error(`Bulk IN failed: ${result.status}`)

        const data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
        const container = USBContainerBuilder.parseContainer(data)

        this.logger.addLog({
            type: 'usb_transfer',
            level: 'info',
            direction: 'receive',
            bytes: data.length,
            endpoint: 'bulkIn',
            endpointAddress: `0x${endpoint.toString(16)}`,
            sessionId: sessionId,
            transactionId: transactionId,
            phase:
                container.type === USBContainerType.COMMAND
                    ? 'request'
                    : container.type === USBContainerType.DATA
                      ? 'data'
                      : 'response',
        })

        return data
    }

    private async clearStall(type: EndpointType): Promise<void> {
        if (!this.device || !this.endpoints) throw new Error('Cannot clear stall')

        await this.getDeviceStatus()

        if (type === EndpointType.BULK_IN) {
            await this.device.clearHalt('in', this.endpoints.bulkIn.endpointNumber)
        } else if (type === EndpointType.BULK_OUT) {
            await this.device.clearHalt('out', this.endpoints.bulkOut.endpointNumber)
        } else if (type === EndpointType.INTERRUPT && this.endpoints.interrupt) {
            await this.device.clearHalt('in', this.endpoints.interrupt.endpointNumber)
        }

        for (let i = 0; i < 10; i++) {
            if ((await this.getDeviceStatus()).code === 0x2001) return
            await new Promise(resolve => setTimeout(resolve, 50))
        }
        throw new Error('STALL recovery failed')
    }

    isConnected() {
        return this.connected
    }
    getType() {
        return TransportType.USB
    }
    isLittleEndian() {
        return true
    }
    getDeviceInfo() {
        return this.deviceInfo
    }
    on(handler: (event: PTPEvent) => void) {
        this.eventHandlers.add(handler)
    }
    off(handler: (event: PTPEvent) => void) {
        this.eventHandlers.delete(handler)
    }

    async classRequestReset(): Promise<void> {
        if (!this.connected || !this.device) throw new Error('Not connected')
        await this.device.controlTransferOut({
            requestType: 'class',
            recipient: 'interface',
            request: USBClassRequest.DEVICE_RESET,
            value: 0,
            index: this.interfaceNumber,
        })
    }

    async cancelRequest(transactionId: number): Promise<void> {
        if (!this.connected || !this.device) throw new Error('Not connected')
        const data = new Uint8Array(6)
        const view = new DataView(data.buffer)
        view.setUint16(0, 0x4001, true)
        view.setUint32(2, transactionId, true)
        await this.device.controlTransferOut(
            {
                requestType: 'class',
                recipient: 'interface',
                request: USBClassRequest.CANCEL_REQUEST,
                value: 0,
                index: this.interfaceNumber,
            },
            data
        )
    }

    async getDeviceStatus(): Promise<DeviceStatus> {
        if (!this.device) throw new Error('Not connected')

        const result = await this.device.controlTransferIn(
            {
                requestType: 'class',
                recipient: 'interface',
                request: USBClassRequest.GET_DEVICE_STATUS,
                value: 0,
                index: this.interfaceNumber,
            },
            20
        )

        if (!result?.data || result.status !== 'ok') throw new Error('Failed to get status')

        const view = new DataView(result.data.buffer)
        const length = view.getUint16(0, true)
        const code = view.getUint16(2, true)
        const parameters: number[] = []
        for (let i = 4; i + 4 <= length && i < result.data.byteLength; i += 4) {
            parameters.push(view.getUint32(i, true))
        }
        return { code, parameters }
    }

    async getExtendedEventData(size = 512): Promise<ExtendedEventData> {
        if (!this.connected || !this.device) throw new Error('Not connected')

        const result = await this.device.controlTransferIn(
            {
                requestType: 'class',
                recipient: 'interface',
                request: USBClassRequest.GET_EXTENDED_EVENT_DATA,
                value: 0,
                index: this.interfaceNumber,
            },
            size
        )

        if (!result?.data || result.status !== 'ok') throw new Error('Failed to get event data')

        const view = new DataView(result.data.buffer)
        const eventCode = view.getUint16(0, true)
        const transactionId = view.getUint32(2, true)
        const numParams = view.getUint16(6, true)
        const parameters: Array<{ size: number; value: Uint8Array }> = []

        let offset = 8
        for (let i = 0; i < numParams && offset + 2 <= result.data.byteLength; i++) {
            const paramSize = view.getUint16(offset, true)
            offset += 2
            if (offset + paramSize <= result.data.byteLength) {
                parameters.push({ size: paramSize, value: new Uint8Array(result.data.buffer, offset, paramSize) })
                offset += paramSize
            }
        }
        return { eventCode, transactionId, parameters }
    }

    async stopEventListening(): Promise<void> {
        this.isListeningForEvents = false
        if (this.endpoints?.interrupt && this.device) await this.clearStall(EndpointType.INTERRUPT)
    }

    private startListeningForEvents(): void {
        if (!this.connected || !this.endpoints?.interrupt || this.isListeningForEvents || !this.device) return

        this.isListeningForEvents = true
        const restart = () =>
            this.isListeningForEvents && ((this.isListeningForEvents = false), this.startListeningForEvents())

        this.device
            .transferIn(this.endpoints.interrupt.endpointNumber, 64)
            .then((result: USBInTransferResult) => {
                if (result.status === 'stall') this.clearStall(EndpointType.INTERRUPT).then(restart)
                else if (result.status === 'ok' && result.data?.byteLength)
                    (this.handleInterruptData(new Uint8Array(result.data.buffer)), restart())
                else restart()
            })
            .catch((error: Error | string) => {
                const msg = error instanceof Error ? error.message : String(error)
                if (!msg.includes('LIBUSB_TRANSFER_CANCELLED') && this.isListeningForEvents) restart()
            })
    }

    private handleInterruptData(data: Uint8Array): void {
        if (!this.endpoints?.interrupt) return

        const container = USBContainerBuilder.parseEvent(data)
        const view = new DataView(container.payload.buffer, container.payload.byteOffset, container.payload.byteLength)
        const event: PTPEvent = { code: container.code, transactionId: container.transactionId, parameters: [] }

        for (let i = 0; i + 4 <= container.payload.length && event.parameters.length < 5; i += 4) {
            event.parameters.push(view.getUint32(i, true))
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

        this.eventHandlers.forEach(handler => handler(event))
    }
}
