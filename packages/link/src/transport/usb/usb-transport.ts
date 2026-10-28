import { Logger } from '@core/logger'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import { InEndpoint, Interface, usb } from 'usb'
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

export const PTP_DISCOVERY_VENDORS = [
    { vendorId: 0x04b0, name: 'Nikon' },
    { vendorId: 0x054c, name: 'Sony' },
    { vendorId: 0x04a9, name: 'Canon' },
    { vendorId: 0x07b4, name: 'Olympus' },
] as const

const LIBUSB_ENDPOINT_IN = usb.LIBUSB_ENDPOINT_IN

function isUsbDeviceGone(error: unknown): boolean {
    return error instanceof Error && /LIBUSB_(?:ERROR|TRANSFER)_NO_DEVICE\b/.test(error.message)
}

export class USBTransport implements TransportInterface {
    private device: USBDevice | null = null
    private interfaceNumber = 0
    private endpoints: EndpointConfiguration | null = null
    private connected = false
    private deviceLost = false
    private usb: USB | null = null
    private usbScope: string | undefined
    private eventHandler: ((event: PTPEvent) => void) | null = null
    private pollingEndpoint: InEndpoint | null = null

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

    private discoveryFilters(device?: DeviceDescriptor): USBDeviceFilter[] {
        if (device?.usb?.filters.length) return device.usb.filters
        return PTP_DISCOVERY_VENDORS.map(vendor => ({ vendorId: vendor.vendorId, classCode: 0x06, subclassCode: 0x01 }))
    }

    private async getUSB(filters: USBDeviceFilter[]): Promise<USB> {
        if (typeof navigator !== 'undefined' && 'usb' in navigator) return navigator.usb

        const scope = JSON.stringify(filters)
        if (this.usb && this.usbScope === scope) return this.usb
        const { WebUSB } = await import('usb')
        this.usb = new WebUSB({ allowedDevices: filters, allowAllDevices: false, deviceTimeout: 1000 })
        this.usbScope = scope
        return this.usb
    }

    async discover(device?: DeviceDescriptor) {
        const filters = this.discoveryFilters(device)
        const usb = await this.getUSB(filters)
        const devices = await usb.getDevices()
        return devices.filter(device => filters.some(filter => this.matchesFilter(device, filter))).map(device => ({
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

    private matchesFilter(device: USBDevice, filter: USBDeviceFilter): boolean {
        if (filter.vendorId !== undefined && device.vendorId !== filter.vendorId) return false
        if (filter.productId !== undefined && device.productId !== filter.productId) return false
        if (filter.serialNumber !== undefined && device.serialNumber !== filter.serialNumber) return false
        if (filter.classCode === undefined) return true
        const alternates = device.configuration?.interfaces.flatMap(iface => iface.alternates) ?? []
        return alternates.some(alternate => alternate.interfaceClass === filter.classCode
            && (filter.subclassCode === undefined || alternate.interfaceSubclass === filter.subclassCode)
            && (filter.protocolCode === undefined || alternate.interfaceProtocol === filter.protocolCode))
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.connected) throw new Error('Already connected')

        const filters = this.discoveryFilters(device)
        const exclusions = device?.usb?.exclusionFilters ?? []
        let availableDevices = await this.discover(device)
        const matches = (candidate: { device: USBDevice }) => filters.some(filter => this.matchesFilter(candidate.device, filter))
            && !exclusions.some(filter => this.matchesFilter(candidate.device, filter))
        if (typeof navigator !== 'undefined' && 'usb' in navigator && !availableDevices.some(matches)) {
            await navigator.usb.requestDevice({ filters, ...(exclusions.length ? { exclusionFilters: exclusions } : {}) })
            availableDevices = await this.discover(device)
        }

        if (availableDevices.length === 0) {
            console.error('[USB] No USB devices found. Make sure camera is connected and in PTP/MTP mode.')
            throw new Error('No USB devices available')
        }

        console.log(JSON.stringify(availableDevices, null, 2))

        console.log(formatDeviceTable(availableDevices))

        const matchingDevice = availableDevices.find(matches)
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
        this.deviceLost = false
        // await this.nukeDevice()

        this.startInterruptListener()
    }

    async disconnect(): Promise<void> {
        if (!this.device && !this.connected) return

        this.connected = false
        this.eventHandler = null
        const failures: unknown[] = []
        try {
            await this.stopInterruptListener()
            await new Promise(resolve => setTimeout(resolve, 100))
            if (!this.deviceLost) await this.clearHalt(EndpointType.INTERRUPT)
        } catch (error) {
            if (!isUsbDeviceGone(error)) failures.push(error)
        }
        try {
            await this.device?.close()
        } catch (error) {
            if (!isUsbDeviceGone(error)) failures.push(error)
        } finally {
            this.device = null
            this.interfaceNumber = 0
            this.endpoints = null
            this.deviceLost = false
        }
        if (failures.length === 1) throw failures[0]
        if (failures.length > 1) throw new AggregateError(failures, 'USB disconnect cleanup failed')
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

        const direction = type === EndpointType.BULK_OUT ? 'out' : 'in'
        const endpoint = (type === EndpointType.BULK_IN ? this.endpoints.bulkIn :
            type === EndpointType.BULK_OUT ? this.endpoints.bulkOut : this.endpoints.interrupt).endpointNumber
        try {
            await this.device.clearHalt(direction, endpoint)
        } catch (error) {
            // node-usb declares LibUSBException as a type, not a runtime constructor.
            if (error instanceof Error &&
                (error.message === 'LIBUSB_TRANSFER_CANCELLED' || error.message === 'LIBUSB_TRANSFER_ERROR')) return
            throw error
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

    private startInterruptListener(): void {
        const pollableEndpoint = this.findPollableInterruptEndpoint()

        if (!pollableEndpoint) {
            this.listenForInterrupt()
            return
        }

        this.pollingEndpoint = pollableEndpoint
        let recoveries = 0
        pollableEndpoint.on('data', (data: Buffer) => {
            if (!this.connected || this.pollingEndpoint !== pollableEndpoint) return
            recoveries = 0
            this.handleInterruptData(new Uint8Array(data), 'ok')
        })
        pollableEndpoint.on('error', error => {
            if (!this.connected || this.handleDeviceLoss(error)) return
            console.error('Error listening for interrupt: ', error)
            // node-usb stops polling after an error. Wait until its pending
            // transfer has ended before clearing the halt and rearming events.
            if (++recoveries > 3) return
            pollableEndpoint.once('end', () => {
                if (!this.connected || this.pollingEndpoint !== pollableEndpoint) return
                void this.clearHalt(EndpointType.INTERRUPT).then(() => {
                    if (this.connected && this.pollingEndpoint === pollableEndpoint)
                        pollableEndpoint.startPoll(1, 64)
                }).catch(recoveryError => console.error('USB event listener recovery failed:', recoveryError))
            })
        })
        pollableEndpoint.startPoll(1, 64)
    }

    /**
     * Under Node the WebUSB device wraps a node-usb device. WebUSB offers no way to cancel an
     * in-flight transferIn, and an interrupt read stays pending until the camera sends an event,
     * so a plain transferIn loop leaves a request outstanding that makes close() fail with
     * "Can't close device with a pending request". node-usb's polling API is cancellable via
     * stopPoll(), so prefer it whenever the underlying endpoint is reachable. Browsers have no
     * such endpoint and fall back to the transferIn loop.
     */
    private findPollableInterruptEndpoint(): InEndpoint | null {
        if (!this.device || !this.endpoints) return null

        const nodeUsbDevice = (this.device as unknown as { device?: { interfaces?: Interface[] } }).device
        if (!nodeUsbDevice?.interfaces) return null

        const address = this.endpoints.interrupt.endpointNumber | LIBUSB_ENDPOINT_IN

        for (const usbInterface of nodeUsbDevice.interfaces) {
            const endpoint = usbInterface.endpoint(address)
            if (endpoint && endpoint.direction === 'in') return endpoint as InEndpoint
        }

        return null
    }

    private async stopInterruptListener(): Promise<void> {
        const endpoint = this.pollingEndpoint
        this.pollingEndpoint = null

        if (!endpoint) return

        if (endpoint.pollActive) {
            await new Promise<void>(resolve => endpoint.stopPoll(() => resolve()))
        }

        endpoint.removeAllListeners('data')
        endpoint.removeAllListeners('error')
    }

    private handleDeviceLoss(error: unknown): boolean {
        if (!isUsbDeviceGone(error)) return false
        this.deviceLost = true
        this.connected = false
        this.logger.addLog({ type: 'console', level: 'info', consoleLevel: 'info', args: ['USB device disconnected'] })
        return true
    }

    private async listenForInterrupt(): Promise<void> {
        while (this.connected && this.device && this.endpoints) {
            try {
                const result = await this.device.transferIn(this.endpoints.interrupt.endpointNumber, 64)

                if (result.data) {
                    const data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
                    this.handleInterruptData(data, result.status)
                }
            } catch (error) {
                // halt will be cleared when device is disconnected, ignore
                if (!this.connected || this.handleDeviceLoss(error)) return

                console.error('Error listening for interrupt: ', error)
            }
        }
    }

    private handleInterruptData(data: Uint8Array, status: USBTransferStatus): void {
        if (!this.endpoints) return

        const container = USBContainerBuilder.parseEvent(data)
        const view = new DataView(container.payload.buffer, container.payload.byteOffset, container.payload.byteLength)
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
            status,
        })

        if (this.eventHandler) {
            this.eventHandler(event)
        }
    }
}
