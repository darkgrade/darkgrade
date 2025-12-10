import { Logger } from '@core/logger'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { LibUSBException } from 'usb'
import { USBContainerBuilder, USBContainerType } from './usb-container'

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

const USB_CLASS_STILL_IMAGE = 6
const USB_SUBCLASS_STILL_IMAGE_CAPTURE = 1

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

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.connected) throw new Error('Already connected')

        const usb = await this.getUSB()
        this.device = await usb.requestDevice(
            device?.usb || {
                filters: [{ classCode: USB_CLASS_STILL_IMAGE, subclassCode: USB_SUBCLASS_STILL_IMAGE_CAPTURE }],
            }
        )
        if (!this.device) throw new Error('No device found')

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
        await this.nukeDevice()

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
        await this.classRequestReset()
        await this.device?.reset()
        await this.clearHalt(EndpointType.BULK_IN)
        await this.clearHalt(EndpointType.BULK_OUT)
        await this.clearHalt(EndpointType.INTERRUPT)
    }

    private findPTPInterface(configuration: USBConfiguration): USBInterface | undefined {
        return configuration.interfaces.find(iface => {
            const alternate = iface.alternates[0] || iface.alternate
            return (
                alternate?.interfaceClass === USB_CLASS_STILL_IMAGE &&
                alternate?.interfaceSubclass === USB_SUBCLASS_STILL_IMAGE_CAPTURE
            )
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
                    console.log('Cleared stall on bulk in endpoint')
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
                    console.log('Cleared stall on bulk out endpoint')
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
                    console.log('Cleared stall on interrupt endpoint')
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
