import { identifyCamera } from '@camera/identification/camera-identification'
import { Logger } from '@core/logger'
import { PTPDisconnectedError } from '@core/ptp-errors'
import { DeviceDescriptor } from '@transport/interfaces/device.interface'
import { TransportType } from '@transport/interfaces/transport-types'
import { PTPEvent, TransportInterface } from '@transport/interfaces/transport.interface'
import type { USBTransportOptions } from '@transport/transport-factory'
import { ContainerType, parseContainer } from '@ptp/container'
import { InEndpoint, Interface, usb } from 'usb'

export interface EndpointConfiguration {
    bulkIn: USBEndpoint
    bulkOut: USBEndpoint
    interrupt: USBEndpoint
}

/** Still-image class Device Reset Request. */
const DEVICE_RESET_REQUEST = 0x66

export const USB_LIMITS = { MAX_USB_TRANSFER: 1024 * 1024 * 1024, DEFAULT_BULK_SIZE: 8192 } as const

/** Any vendor's PTP still-image interface; the default when no device descriptor names a body. */
const PTP_STILL_IMAGE_FILTER = { classCode: 0x06, subclassCode: 0x01 } as const

const LIBUSB_ENDPOINT_IN = usb.LIBUSB_ENDPOINT_IN
/** Marks a bulk-IN reader released by a Device Reset Request or disconnect. */
const RELEASED = new Error('Bulk IN reader released')

type NodeUSBDevice = ReturnType<typeof usb.getDeviceList>[number]

function hasMatchingInterface(device: NodeUSBDevice, filter: USBDeviceFilter): boolean {
    try {
        return device.allConfigDescriptors.some(configuration =>
            configuration.interfaces.flat().some(
                descriptor =>
                    descriptor.bInterfaceClass === filter.classCode &&
                    (filter.subclassCode === undefined || descriptor.bInterfaceSubClass === filter.subclassCode) &&
                    (filter.protocolCode === undefined || descriptor.bInterfaceProtocol === filter.protocolCode)
            )
        )
    } catch {
        return false
    }
}

/**
 * node-usb opens every device a filter without vendor and product admits, to read its interfaces.
 * Narrow such an interface-class filter to the ids whose config descriptors, readable without
 * opening the device, carry that interface, so hubs, capture cards and other devices stay closed.
 */
function narrowInterfaceFilters(filters: USBDeviceFilter[], devices: NodeUSBDevice[]): USBDeviceFilter[] {
    return filters.flatMap(filter => {
        if (filter.vendorId !== undefined || filter.productId !== undefined || filter.classCode === undefined)
            return [filter]
        return devices
            .filter(device => hasMatchingInterface(device, filter))
            .map(device => ({ ...filter, vendorId: device.deviceDescriptor.idVendor, productId: device.deviceDescriptor.idProduct }))
    })
}

/** One string descriptor through node-usb's callback API; undefined when the device has none or will not say. */
function stringDescriptor(device: NodeUSBDevice, index: number): Promise<string | undefined> {
    if (!index) return Promise.resolve(undefined)
    return new Promise(resolve => {
        try {
            device.getStringDescriptor(index, (error, value) => resolve(error ? undefined : value || undefined))
        } catch {
            resolve(undefined)
        }
    })
}

/**
 * A device's manufacturer, product and serial strings. One this process already has open (its
 * interfaces are set) is read on that handle and left open; another is opened for the read and
 * closed after. A device that cannot be opened (claimed by another process) is listed without them.
 */
async function deviceStrings(device: NodeUSBDevice): Promise<{ manufacturer?: string; model?: string; serialNumber?: string }> {
    const alreadyOpen = device.interfaces !== undefined
    if (!alreadyOpen) {
        try {
            device.open(false)
        } catch {
            return {}
        }
    }
    try {
        const { iManufacturer, iProduct, iSerialNumber } = device.deviceDescriptor
        const [manufacturer, model, serialNumber] = await Promise.all(
            [iManufacturer, iProduct, iSerialNumber].map(index => stringDescriptor(device, index))
        )
        return { ...(manufacturer && { manufacturer }), ...(model && { model }), ...(serialNumber && { serialNumber }) }
    } finally {
        if (!alreadyOpen)
            try {
                device.close()
            } catch {
                /* The strings were read or not; closing a handle this call opened never fails the list. */
            }
    }
}

function isUsbDeviceGone(error: unknown): boolean {
    return error instanceof Error && /LIBUSB_(?:ERROR|TRANSFER)_NO_DEVICE\b/.test(error.message)
}

export class USBTransport implements TransportInterface {
    readonly telemetryEvidence = 'hardware' as const
    private device: USBDevice | null = null
    private interfaceNumber = 0
    private endpoints: EndpointConfiguration | null = null
    private connected = false
    private deviceLost = false
    private usb: USB | null = null
    private usbScope: string | undefined
    private eventHandler: ((event: PTPEvent) => void) | null = null
    private pollingEndpoint: InEndpoint | null = null
    /**
     * A submitted bulk-IN transfer no reader has consumed yet. WebUSB and libusb cannot cancel a
     * transfer, so a read abandoned by a transaction timeout stays queued on the endpoint and would
     * swallow the next container. Instead the next reader takes over this transfer.
     */
    private bulkInTransfer: { result: Promise<USBInTransferResult>; length: number } | null = null
    /** Readers waiting on bulk IN; the Device Reset Request releases them so abandoned reads settle. */
    private readonly bulkInReaders = new Set<(error: Error) => void>()

    private readonly maxBulkReadBytes: number
    /** The caller's own WebUSB implementation (USBTransportOptions.usb), used as it is. */
    private readonly suppliedUsb: USB | null

    constructor(
        private logger: Logger,
        options: USBTransportOptions = {}
    ) {
        // A receive limit bounds a complete PTP dataset, not one libusb allocation.
        // Large object reads are assembled below from bounded endpoint transfers.
        const limit = options.maxBulkReadBytes ?? USB_LIMITS.DEFAULT_BULK_SIZE
        if (!Number.isInteger(limit) || limit < 1024 || limit > USB_LIMITS.MAX_USB_TRANSFER || limit % 1024 !== 0)
            throw new Error('maxBulkReadBytes must be a multiple of 1024 between 1024 and 1073741824')
        this.maxBulkReadBytes = limit
        this.suppliedUsb = options.usb ?? null
    }

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
        return [PTP_STILL_IMAGE_FILTER]
    }

    /** Returns null when no attached device can match, so node-usb opens nothing. */
    private async getUSB(filters: USBDeviceFilter[]): Promise<USB | null> {
        if (typeof navigator !== 'undefined' && 'usb' in navigator) return navigator.usb
        if (this.suppliedUsb) return this.suppliedUsb

        const allowedDevices = narrowInterfaceFilters(filters, usb.getDeviceList())
        if (!allowedDevices.length) return null
        const scope = JSON.stringify(allowedDevices)
        if (this.usb && this.usbScope === scope) return this.usb
        const { WebUSB } = await import('usb')
        this.usb = new WebUSB({ allowedDevices, allowAllDevices: false, deviceTimeout: 1000 })
        this.usbScope = scope
        return this.usb
    }

    /** Attached USB cameras the descriptor admits; with none, any vendor's PTP still-image body. */
    async discover(device?: DeviceDescriptor) {
        const filters = this.discoveryFilters(device)
        const usb = await this.getUSB(filters)
        const devices = usb ? await usb.getDevices() : []
        return devices
            .filter(device => filters.some(filter => this.matchesFilter(device, filter)))
            .map(device => {
                const alternate = device.configuration?.interfaces?.[0]?.alternates?.[0]
                return {
                    device,
                    vendorId: device.vendorId,
                    productId: device.productId,
                    identification: identifyCamera({ vendorId: device.vendorId, productId: device.productId }),
                    manufacturer: device.manufacturerName ?? undefined,
                    model: device.productName ?? undefined,
                    serialNumber: device.serialNumber ?? undefined,
                    classCode: alternate?.interfaceClass,
                    subclassCode: alternate?.interfaceSubclass,
                    protocolCode: alternate?.interfaceProtocol,
                }
            })
    }

    /**
     * Every attached PTP still-image body, for Camera.discover, read from USB descriptors rather than
     * through node-usb's WebUSB: that drops any device it cannot open (and closes one it finds open),
     * so a body this process already had open was never listed (darkgrade02, 2026-11-25). In a browser,
     * or with a supplied WebUSB, it is `discover()`.
     */
    async listAttached(): Promise<
        { vendorId: number; productId: number; manufacturer?: string; model?: string; serialNumber?: string }[]
    > {
        if ((typeof navigator !== 'undefined' && 'usb' in navigator) || this.suppliedUsb)
            return (await this.discover()).map(({ vendorId, productId, manufacturer, model, serialNumber }) => ({
                vendorId,
                productId,
                ...(manufacturer && { manufacturer }),
                ...(model && { model }),
                ...(serialNumber && { serialNumber }),
            }))
        const cameras = usb.getDeviceList().filter(device => hasMatchingInterface(device, PTP_STILL_IMAGE_FILTER))
        const listed = []
        for (const device of cameras)
            listed.push({ vendorId: device.deviceDescriptor.idVendor, productId: device.deviceDescriptor.idProduct, ...(await deviceStrings(device)) })
        return listed
    }

    private matchesFilter(device: USBDevice, filter: USBDeviceFilter): boolean {
        if (filter.vendorId !== undefined && device.vendorId !== filter.vendorId) return false
        if (filter.productId !== undefined && device.productId !== filter.productId) return false
        if (filter.serialNumber !== undefined && device.serialNumber !== filter.serialNumber) return false
        if (filter.classCode === undefined) return true
        const alternates = device.configuration?.interfaces.flatMap(iface => iface.alternates) ?? []
        return alternates.some(
            alternate =>
                alternate.interfaceClass === filter.classCode &&
                (filter.subclassCode === undefined || alternate.interfaceSubclass === filter.subclassCode) &&
                (filter.protocolCode === undefined || alternate.interfaceProtocol === filter.protocolCode)
        )
    }

    async connect(device?: DeviceDescriptor): Promise<void> {
        if (this.connected) throw new Error('Already connected')

        const filters = this.discoveryFilters(device)
        const exclusions = device?.usb?.exclusionFilters ?? []
        let availableDevices = await this.discover(device)
        const matches = (candidate: { device: USBDevice }) =>
            filters.some(filter => this.matchesFilter(candidate.device, filter)) &&
            !exclusions.some(filter => this.matchesFilter(candidate.device, filter))
        if (typeof navigator !== 'undefined' && 'usb' in navigator && !availableDevices.some(matches)) {
            await navigator.usb.requestDevice({
                filters,
                ...(exclusions.length ? { exclusionFilters: exclusions } : {}),
            })
            availableDevices = await this.discover(device)
        }

        if (availableDevices.length === 0) throw new Error('No USB devices available')

        // Discovery is scoped by the descriptor's filters; a physical mapping must still select one body.
        const matching = availableDevices.filter(matches)
        if (matching.length > 1)
            throw new Error('Multiple USB cameras match; select a unique serialNumber before connecting')
        const matchingDevice = matching[0]
        if (!matchingDevice?.device) throw new Error('No matching device found in discovered devices')
        this.device = matchingDevice.device as USBDevice
        const { vendorId, productId } = matchingDevice
        this.logInfo(`Selected USB camera 0x${vendorId.toString(16)}:0x${productId.toString(16)}`)

        try {
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

            this.startInterruptListener()
        } catch (error) {
            try {
                await this.disconnect()
            } catch (cleanupError) {
                throw new AggregateError([error, cleanupError], 'USB connection and cleanup failed')
            }
            throw error
        }
    }

    /** Identity of the uniquely selected, opened USB body; no PTP operation is needed. */
    getDeviceIdentity(): { vendorId: number; productId: number } | undefined {
        return this.connected && this.device
            ? { vendorId: this.device.vendorId, productId: this.device.productId }
            : undefined
    }

    async resetPort(): Promise<void> {
        const nodeUsbDevice = (
            this.device as unknown as { device?: { reset(callback: (error?: unknown) => void): void } }
        )?.device
        if (!nodeUsbDevice) throw new Error('Not connected')
        await this.stopInterruptListener()
        await new Promise<void>((resolve, reject) =>
            nodeUsbDevice.reset(error => (error && !isUsbDeviceGone(error) ? reject(error) : resolve()))
        )
        this.deviceLost = true
        await this.disconnect()
    }

    /** Close partially opened devices too; failed initialization never sets connected=true. */
    async disconnect(): Promise<void> {
        if (!this.device && !this.connected) return

        const wasConnected = this.connected
        this.connected = false
        this.eventHandler = null
        for (const release of [...this.bulkInReaders]) release(RELEASED)
        this.bulkInTransfer = null
        const failures: unknown[] = []
        try {
            await this.stopInterruptListener()
            // A partial open never started event polling, and a removed device has no endpoint to clear.
            if (wasConnected && !this.deviceLost) {
                await new Promise(resolve => setTimeout(resolve, 100))
                await this.clearHalt('interrupt')
            }
        } catch (error) {
            // The device closes next either way, so an unconfirmed clear on the way out is not a failure.
            const unconfirmedClear = error instanceof Error && error.message === 'LIBUSB_TRANSFER_ERROR'
            if (!isUsbDeviceGone(error) && !unconfirmedClear) failures.push(error)
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

    /** The opened device, or PTPDisconnectedError once it is closed or unplugged. */
    private requireDevice(): USBDevice {
        if (!this.connected || !this.endpoints || !this.device)
            throw new PTPDisconnectedError(
                this.deviceLost ? 'the USB camera was unplugged' : 'the USB camera is not connected'
            )
        return this.device
    }

    /** Runs one USB transfer; a device that disappeared under it ends the connection as PTPDisconnectedError. */
    private async whileAttached<Result>(transfer: () => Promise<Result>): Promise<Result> {
        try {
            return await transfer()
        } catch (error) {
            if (!this.handleDeviceLoss(error)) throw error
            throw new PTPDisconnectedError('the USB camera was unplugged', { cause: error })
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
        const device = this.requireDevice()
        const endpoint = this.endpoints!.bulkOut.endpointNumber
        const result = await this.whileAttached(() => device.transferOut(endpoint, Uint8Array.from(data)))

        this.logBulkTransfer('send', data, endpoint, sessionId, transactionId, result.status)

        if (result.status === 'stall') await this.clearHalt('bulkOut')
    }

    async receive(maxLength: number, sessionId: number, transactionId: number): Promise<Uint8Array> {
        this.requireDevice()
        const endpoint = this.endpoints!.bulkIn.endpointNumber
        const requested = Math.min(maxLength, this.maxBulkReadBytes)
        let received = await this.readBulkIn(endpoint, requested)
        // An exactly packet-aligned data phase can leave its terminating ZLP for the next read.
        if (received.result.status === 'ok' && received.result.data?.byteLength === 0)
            received = await this.readBulkIn(endpoint, requested)
        const { result } = received

        if (result.status === 'stall') await this.clearHalt('bulkIn')
        if (result.status !== 'ok' || !result.data || result.data.byteLength === 0)
            throw new Error(`Bulk IN failed: ${result.status}`)

        let data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
        // A bounded capture read, or a transfer taken over from an abandoned reader, may be shorter.
        const declared = data.byteLength >= 4 ? new DataView(data.buffer, data.byteOffset).getUint32(0, true) : 0
        if (declared > maxLength) throw new Error(`USB container length ${declared} exceeds receive limit ${maxLength}`)
        // Cameras may send the header and dataset in separate short USB transfers.
        // The declared PTP length, rather than the USB short packet, ends the container.
        if (declared > data.byteLength && declared <= maxLength)
            data = await this.readRemainder(endpoint, data, declared)

        this.logBulkTransfer('receive', data, endpoint, sessionId, transactionId, result.status)

        return data
    }

    private logInfo(message: string): void {
        this.logger.addLog({ type: 'console', level: 'info', consoleLevel: 'info', args: [message] })
    }

    private logError(message: string, error: unknown): void {
        this.logger.addLog({ type: 'console', level: 'error', consoleLevel: 'error', args: [message, error instanceof Error ? error.message : String(error)] })
    }

    private logBulkTransfer(
        direction: 'send' | 'receive',
        data: Uint8Array,
        endpoint: number,
        sessionId: number,
        transactionId: number,
        status: USBTransferStatus
    ): void {
        const { type } = parseContainer(data)
        this.logger.addLog({
            type: 'usb_transfer',
            level: 'info',
            direction,
            bytes: data.length,
            endpoint: direction === 'send' ? 'bulkOut' : 'bulkIn',
            endpointAddress: `0x${endpoint.toString(16)}`,
            sessionId,
            transactionId,
            phase: type === ContainerType.COMMAND ? 'request' : type === ContainerType.DATA ? 'data' : 'response',
            status,
        })
    }

    /** Takes over a pending bulk-IN transfer or submits one; leaves it queued if this reader is released. */
    private async readBulkIn(
        endpoint: number,
        maxLength: number
    ): Promise<{ result: USBInTransferResult; length: number }> {
        if (!this.bulkInTransfer) {
            const device = this.requireDevice()
            const result = this.whileAttached(() => device.transferIn(endpoint, maxLength))
            result.catch(() => undefined)
            this.bulkInTransfer = { result, length: maxLength }
        }
        const transfer = this.bulkInTransfer
        let release!: (error: Error) => void
        const released = new Promise<never>((_, reject) => {
            release = reject
        })
        this.bulkInReaders.add(release)
        try {
            const result = await Promise.race([transfer.result, released])
            if (this.bulkInTransfer === transfer) this.bulkInTransfer = null
            return { result, length: transfer.length }
        } catch (error) {
            // A failed transfer is consumed; a released reader leaves the transfer for the next one.
            if (error === RELEASED)
                throw this.deviceLost
                    ? new PTPDisconnectedError('the USB camera was unplugged during the read')
                    : new Error('Bulk IN read released by a Device Reset Request or disconnect')
            if (this.bulkInTransfer === transfer) this.bulkInTransfer = null
            throw error
        } finally {
            this.bulkInReaders.delete(release)
        }
    }

    private async readRemainder(endpoint: number, head: Uint8Array, declared: number): Promise<Uint8Array> {
        const data = new Uint8Array(declared)
        data.set(head)
        let offset = head.byteLength
        while (offset < declared) {
            const { result } = await this.readBulkIn(endpoint, Math.min(declared - offset, this.maxBulkReadBytes))
            if (result.status !== 'ok' || !result.data || result.data.byteLength === 0)
                throw new Error(`Bulk IN failed: ${result.status}`)
            const chunk = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
            if (chunk.byteLength > declared - offset) throw new Error('Bulk IN returned more than the container length')
            data.set(chunk, offset)
            offset += chunk.byteLength
        }
        return data
    }

    private async clearHalt(type: keyof EndpointConfiguration): Promise<void> {
        if (!this.device || !this.endpoints) throw new Error('Cannot clear stall')
        const direction = type === 'bulkOut' ? 'out' : 'in'
        const endpoint = this.endpoints[type].endpointNumber
        try {
            await this.device.clearHalt(direction, endpoint)
        } catch (error) {
            // node-usb declares LibUSBException as a type, not a runtime constructor. A cancelled request is the
            // endpoint's own teardown; any other failure leaves the halt in place, so it is reported.
            if (error instanceof Error && error.message === 'LIBUSB_TRANSFER_CANCELLED') return
            throw error
        }
    }

    public on(handler: (event: PTPEvent) => void) {
        this.eventHandler = handler
    }

    public off(handler: (event: PTPEvent) => void) {
        if (this.eventHandler === handler) this.eventHandler = null
    }

    /**
     * Still-image class Device Reset Request: the camera returns to idle and drops the abandoned
     * transaction. Readers left waiting by that transaction are released; the bulk-IN transfer they
     * submitted stays queued for the next reader, which discards any late reply by transaction ID.
     */
    async classRequestReset(): Promise<void> {
        if (!this.device) throw new Error('Not connected')
        const result = await this.device.controlTransferOut({
            requestType: 'class',
            recipient: 'interface',
            request: DEVICE_RESET_REQUEST,
            value: 0,
            index: this.interfaceNumber,
        })
        if (result && result.status !== 'ok') throw new Error(`Device Reset Request failed: ${result.status}`)
        for (const release of [...this.bulkInReaders]) release(RELEASED)
    }

    private startInterruptListener(): void {
        const pollableEndpoint = this.findPollableInterruptEndpoint()
        if (!pollableEndpoint) return void this.listenForInterrupt()

        this.pollingEndpoint = pollableEndpoint
        let recoveries = 0
        pollableEndpoint.on('data', (data: Buffer) => {
            if (!this.connected || this.pollingEndpoint !== pollableEndpoint) return
            recoveries = 0
            this.handleInterruptData(new Uint8Array(data), 'ok')
        })
        pollableEndpoint.on('error', error => {
            if (!this.connected || this.handleDeviceLoss(error)) return
            this.logError('Error listening for interrupt:', error)
            // node-usb stops polling after an error. Wait until its pending
            // transfer has ended before clearing the halt and rearming events.
            if (++recoveries > 3) return
            pollableEndpoint.once('end', () => {
                if (!this.connected || this.pollingEndpoint !== pollableEndpoint) return
                void this.clearHalt('interrupt')
                    .then(() => {
                        if (this.connected && this.pollingEndpoint === pollableEndpoint)
                            pollableEndpoint.startPoll(1, 64)
                    })
                    .catch(recoveryError => this.logError('USB event listener recovery failed:', recoveryError))
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

        if (endpoint.pollActive) await new Promise<void>(resolve => endpoint.stopPoll(() => resolve()))

        endpoint.removeAllListeners('data')
        endpoint.removeAllListeners('error')
    }

    /**
     * A removed device ends the connection once: event polling stops (it is never re-armed), and
     * waiting bulk readers are released, so nothing keeps submitting transfers to a freed handle.
     */
    private handleDeviceLoss(error: unknown): boolean {
        if (!isUsbDeviceGone(error)) return false
        if (this.deviceLost) return true
        this.deviceLost = true
        this.connected = false
        this.bulkInTransfer = null
        for (const release of [...this.bulkInReaders]) release(RELEASED)
        void this.stopInterruptListener().catch(() => undefined)
        this.logInfo('USB device disconnected')
        return true
    }

    private async listenForInterrupt(): Promise<void> {
        let failures = 0
        while (this.connected && this.device && this.endpoints) {
            try {
                const result = await this.device.transferIn(this.endpoints.interrupt.endpointNumber, 64)
                failures = 0

                if (result.data) {
                    const data = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
                    this.handleInterruptData(data, result.status)
                }
            } catch (error) {
                // halt will be cleared when device is disconnected, ignore
                if (!this.connected || this.handleDeviceLoss(error)) return
                // A WebUSB implementation that times its reads out (node-usb-rs) cancels this one about once a second
                // while the camera has nothing to report: there is no event yet, so read again.
                if (error instanceof Error && error.message === 'Cancelled') continue

                this.logError('Error listening for interrupt:', error)
                // A failing endpoint is retried a few times, spaced out; it never spins.
                if (++failures > 3) return
                await new Promise(resolve => setTimeout(resolve, 100 * failures))
            }
        }
    }

    private handleInterruptData(data: Uint8Array, status: USBTransferStatus): void {
        if (!this.endpoints) return

        const container = parseContainer(data, ContainerType.EVENT)
        const view = new DataView(container.payload.buffer, container.payload.byteOffset, container.payload.byteLength)
        const event: PTPEvent = { code: container.code, transactionId: container.transactionId, parameters: [] }

        for (let i = 0; i + 4 <= container.payload.length && event.parameters.length < 5; i += 4)
            event.parameters.push(view.getUint32(i, true))
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

        this.eventHandler?.(event)
    }
}
