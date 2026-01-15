import { Logger } from '@core/logger'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { LibUSBException } from 'usb'
import { USBContainerBuilder, USBContainerType } from './usb-container'
import { formatDeviceTable } from './usb-device-table'

export enum EndpointType {
    BULK_IN = 'bulk_in',
    BULK_OUT = 'bulk_out',
    INTERRUPT = 'interrupt',
}

export interface EndpointConfiguration {
    bulkIn: USBEndpoint
    bulkOut: USBEndpoint
    interrupt: USBEndpoint
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

export const USB_LIMITS = { MAX_USB_TRANSFER: 1024 * 1024 * 1024, DEFAULT_BULK_SIZE: 8192 } as const

export class USBTransport implements TransportInterface {
    private device: USBDevice | null = null
    private interfaceNumber = 0
    private endpoints: EndpointConfiguration | null = null
    private connected = false
    private usb: USB | null = null
    private eventHandler: ((event: PTPEvent) => void) | null = null

    constructor(private logger: Logger) {}

    public isConnected() {
        return this.connected
    }

    public getType() {
        return TransportType.USB
    }

    public isLittleEndian() {
        return true
    }

    private async getUSB(): Promise<USB> {
        if (this.usb) return this.usb
        this.usb = typeof navigator !== 'undefined' && 'usb' in navigator ? navigator.usb : (await import('usb')).webusb
        return this.usb
    }

    async discover() {
        const usb = await this.getUSB()

        // Request devices for common camera vendors with PTP/Still Image class
        const cameraVendors = [
            { vendorId: 0x04b0, name: 'Nikon' }, // Nikon
            { vendorId: 0x054c, name: 'Sony' }, // Sony
            { vendorId: 0x04a9, name: 'Canon' }, // Canon
        ]

        for (const vendor of cameraVendors) {
            try {
                await usb.requestDevice({
                    filters: [
                        {
                            vendorId: vendor.vendorId,
                            classCode: 0x06,
                            subclassCode: 0x01,
                        },
                    ],
                })
            } catch (e) {
                // Device not found or access denied
            }
        }

        const devices = await usb.getDevices()
        return devices.map(device => ({
            device,
            vendorId: device.vendorId,
            productId: device.productId,
            manufacturer: device.manufacturerName ?? undefined,
            model: device.productName ?? undefined,
            serialNumber: device.serialNumber ?? undefined,
            classCode: device.configuration?.interfaces?.[0]?.alternates?.[0]?.interfaceClass,
            subclassCode: device.configuration?.interfaces?.[0]?.alternates?.[0]?.interfaceSubclass,
        }))
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.connected) throw new Error('Already connected')

        const usb = await this.getUSB()

        const availableDevices = await this.discover()

        if (availableDevices.length === 0) {
            console.error('[USB] No USB devices found. Make sure camera is connected and in PTP/MTP mode.')
            throw new Error('No USB devices available')
        }

        console.log(JSON.stringify(availableDevices, null, 2))

        console.log(formatDeviceTable(availableDevices))

        const filters = device?.usb?.filters || [{ classCode: 0x06, subclassCode: 0x01 }]

        const matchingDevice = availableDevices.find(d => {
            const filter = filters[0]
            if (filter.vendorId !== undefined && d.vendorId !== filter.vendorId) return false
            if (filter.productId !== undefined && d.productId !== filter.productId) return false
            if (filter.classCode !== undefined && d.classCode !== filter.classCode) return false
            if (filter.subclassCode !== undefined && d.subclassCode !== filter.subclassCode) return false
            return true
        })
        if (!matchingDevice?.device) {
            throw new Error('No matching device found in discovered devices')
        }
        this.device = matchingDevice.device as USBDevice
        console.log(
            `[USB] Selected device: VID:PID 0x${matchingDevice.vendorId?.toString(16).padStart(4, '0')}:0x${matchingDevice.productId?.toString(16).padStart(4, '0')} - ${matchingDevice.manufacturer || 'Unknown'} ${matchingDevice.model || 'Unknown'}`
        )

        await this.device.open()

        const configuration = this.device.configuration ?? this.device.configurations?.[0]
        if (!configuration) throw new Error('No USB configuration found')

        const ptpInterface = this.findPTPInterface(configuration)
        if (!ptpInterface) throw new Error('PTP interface not found')

        this.interfaceNumber = ptpInterface.interfaceNumber
        await this.device.claimInterface(this.interfaceNumber)

        const alternate = ptpInterface.alternates[0] || ptpInterface.alternate
        if (!alternate) throw new Error('No alternate interface')

        this.endpoints = this.findEndpoints(alternate)
        this.connected = true
        // await this.nukeDevice()

        this.listenForInterrupt()
    }

    async disconnect(): Promise<void> {
        if (!this.connected) return

        this.connected = false
        this.eventHandler = null

        // give events 100ms to complete if any are pending
        await new Promise(resolve => setTimeout(resolve, 100))
        await this.clearHalt(EndpointType.INTERRUPT)
        // await this.device?.reset()
        // await this.nukeDevice()

        await this.device?.close()

        this.device = null
        this.interfaceNumber = 0
        this.endpoints = null
    }

    private async nukeDevice(): Promise<void> {
        try {
            await this.classRequestReset()
        } catch (error) {
            console.error('classRequestReset error:', error)
        }

        try {
            await this.clearHalt(EndpointType.BULK_IN)
        } catch (error) {
            console.error('clearHalt BULK_IN error:', error)
        }

        try {
            await this.clearHalt(EndpointType.BULK_OUT)
        } catch (error) {
            console.error('clearHalt BULK_OUT error:', error)
        }

        try {
            await this.clearHalt(EndpointType.INTERRUPT)
        } catch (error) {
            console.error('clearHalt INTERRUPT error:', error)
        }
    }

    private findPTPInterface(configuration: USBConfiguration): USBInterface | undefined {
        return configuration.interfaces.find(iface => {
            const alternate = iface.alternates[0] || iface.alternate
            return alternate?.interfaceClass === 0x06 && alternate?.interfaceSubclass === 0x01
        })
    }

    private findEndpoints(alternate: USBAlternateInterface): EndpointConfiguration {
        const bulkIn = alternate.endpoints.find(ep => ep.direction === 'in' && ep.type === 'bulk')
        const bulkOut = alternate.endpoints.find(ep => ep.direction === 'out' && ep.type === 'bulk')
        const interrupt = alternate.endpoints.find(ep => ep.direction === 'in' && ep.type === 'interrupt')
        if (!bulkIn || !bulkOut || !interrupt) throw new Error('USB endpoints not found')
        return { bulkIn, bulkOut, interrupt }
    }

    async send(data: Uint8Array, sessionId: number, transactionId: number): Promise<void> {
        if (!this.connected || !this.endpoints || !this.device) throw new Error('Not connected')

        const endpoint = this.endpoints.bulkOut.endpointNumber
        const container = USBContainerBuilder.parseContainer(data)

        let result = await this.device.transferOut(endpoint, Uint8Array.from(data))

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
            status: result.status,
        })

        if (result.status === 'stall') {
            await this.clearHalt(EndpointType.BULK_OUT)
        }
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints || !this.device) throw new Error('Not connected')

        const endpoint = this.endpoints.bulkIn.endpointNumber
        let result = await this.device.transferIn(endpoint, maxLength)

        if (result.status === 'stall') {
            await this.clearHalt(EndpointType.BULK_IN)
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
            status: result.status,
        })

        return data
    }

    private async clearHalt(type: EndpointType): Promise<void> {
        if (!this.device || !this.endpoints) throw new Error('Cannot clear stall')

        if (type === EndpointType.BULK_IN) {
            try {
                await this.device.clearHalt('in', this.endpoints.bulkIn.endpointNumber)
            } catch (error) {
                if (
                    error instanceof LibUSBException &&
                    (error.message === 'LIBUSB_TRANSFER_CANCELLED' || error.message === 'LIBUSB_TRANSFER_ERROR')
                ) {
                    // Stall cleared
                }
            }
        } else if (type === EndpointType.BULK_OUT) {
            try {
                await this.device.clearHalt('out', this.endpoints.bulkOut.endpointNumber)
            } catch (error) {
                if (
                    error instanceof LibUSBException &&
                    (error.message === 'LIBUSB_TRANSFER_CANCELLED' || error.message === 'LIBUSB_TRANSFER_ERROR')
                ) {
                    // Stall cleared
                }
            }
        } else if (type === EndpointType.INTERRUPT) {
            try {
                await this.device.clearHalt('in', this.endpoints.interrupt.endpointNumber)
            } catch (error) {
                if (
                    error instanceof LibUSBException &&
                    (error.message === 'LIBUSB_TRANSFER_CANCELLED' || error.message === 'LIBUSB_TRANSFER_ERROR')
                ) {
                    // Stall cleared
                }
            }
        }
    }

    public on(handler: (event: PTPEvent) => void) {
        this.eventHandler = handler
    }

    public off(handler: (event: PTPEvent) => void) {
        this.eventHandler = null
    }

    async classRequestReset(): Promise<void> {
        await this.device?.controlTransferOut({
            requestType: 'class',
            recipient: 'interface',
            request: USBClassRequest.DEVICE_RESET,
            value: 0,
            index: this.interfaceNumber,
        })
    }

    async classRequestGetDeviceStatus(): Promise<DeviceStatus> {
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

    private async listenForInterrupt(): Promise<void> {
        while (this.connected && this.device && this.endpoints) {
            try {
                const result = await this.device.transferIn(this.endpoints.interrupt.endpointNumber, 64)

                if (result.data) {
                    const data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
                    const container = USBContainerBuilder.parseEvent(data)
                    const view = new DataView(
                        container.payload.buffer,
                        container.payload.byteOffset,
                        container.payload.byteLength
                    )
                    const event: PTPEvent = {
                        code: container.code,
                        transactionId: container.transactionId,
                        parameters: [],
                    }

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
                        status: result.status,
                    })

                    if (this.eventHandler) {
                        this.eventHandler(event)
                    }
                }
            } catch (error) {
                // halt will be cleared when device is disconnected, ignore
                if (!this.connected) return

                console.error('Error listening for interrupt: ', error)
            }
        }
    }
}
