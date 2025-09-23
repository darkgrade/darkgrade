import { TransportInterface } from '@transport/interfaces/transport.interface'
import { EndpointManagerInterface, EndpointType, DeviceFinderInterface, DeviceDescriptor, TransportType } from '@transport/interfaces/transport.interface'
import { USB_LIMITS } from '@constants/ptp/containers'
import { toBuffer, toUint8Array } from '@core/buffers'

/**
 * USB transport implementation for PTP communication
 */
export class USBTransport implements TransportInterface {
    private device: any = null
    private interface: any = null
    private endpoints: any = null
    private connected = false
    private readonly isWebEnvironment = typeof navigator !== 'undefined' && 'usb' in navigator
    private deviceInfo: { vendorId: number; productId: number } | null = null

    constructor(
        private readonly deviceFinder: DeviceFinderInterface,
        private readonly endpointManager: EndpointManagerInterface
    ) {}

    /**
     * Connect to a USB device
     */
    async connect(deviceIdentifier: DeviceDescriptor): Promise<void> {
        if (this.connected) {
            throw new Error('Already connected')
        }

        let device: any = null

        // In web environment with auto-discovery (vendorId 0), directly request device
        if (this.isWebEnvironment && deviceIdentifier.vendorId === 0) {
            device = await this.deviceFinder.requestDevice({
                vendorId: undefined, // Will show all PTP devices
                productId: undefined,
                class: 6, // PTP/Still Image class
            })
        } else {
            // Find device - include PTP class filter to ensure we find PTP devices
            const devices = await this.deviceFinder.findDevices({
                vendorId: deviceIdentifier.vendorId,
                productId: deviceIdentifier.productId,
                class: 6, // PTP/Still Image class
            })

            device = devices.find(d => {
                if (deviceIdentifier.serialNumber) {
                    return d.serialNumber === deviceIdentifier.serialNumber
                }
                return true
            })

            if (!device && this.isWebEnvironment) {
                // Request device access in web environment
                device = await this.deviceFinder.requestDevice({
                    vendorId: deviceIdentifier.vendorId,
                    productId: deviceIdentifier.productId,
                })
            }
        }

        if (!device) {
            throw new Error(`Device not found: ${deviceIdentifier.vendorId}:${deviceIdentifier.productId}`)
        }

        this.device = device.device
        this.deviceInfo = { vendorId: device.vendorId, productId: device.productId }

        if (this.isWebEnvironment) {
            await this.connectWebUSB()
        } else {
            await this.connectNodeUSB()
        }

        this.connected = true
    }

    /**
     * Disconnect from the current device
     */
    async disconnect(): Promise<void> {
        if (!this.connected) {
            return
        }

        if (this.isWebEnvironment) {
            if (this.interface) {
                await this.device.releaseInterface(this.interface.interfaceNumber)
            }
            await this.device.close()
        } else {
            await this.endpointManager.releaseEndpoints()
            try {
                this.device.close()
            } catch {
                // Ignore errors during close
            }
        }

        this.device = null
        this.interface = null
        this.endpoints = null
        this.connected = false
    }

    /**
     * Send data to the device
     */
    async send(data: Uint8Array): Promise<void> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const buffer = toBuffer(data)
        const endpointAddress = this.isWebEnvironment
            ? this.endpoints.bulkOut.endpointNumber
            : this.endpoints.bulkOut.descriptor.bEndpointAddress
        console.log(`USB Transport: Sending ${buffer.length} bytes to endpoint 0x${endpointAddress.toString(16)}`)

        if (this.isWebEnvironment) {
            const result = await this.device.transferOut(this.endpoints.bulkOut.endpointNumber, buffer)
            if (result.status !== 'ok') {
                throw new Error(`Transfer failed: ${result.status}`)
            }
        } else {
            await this.sendNodeUSB(buffer)
        }
    }

    /**
     * Receive data from the device
     */
    async receive(maxLength: number = USB_LIMITS.DEFAULT_BULK_SIZE): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const endpointAddr = this.isWebEnvironment 
            ? this.endpoints.bulkIn.endpointNumber 
            : (this.endpoints.bulkIn as any).descriptor?.bEndpointAddress
        console.log(`USB Transport: Receiving up to ${maxLength} bytes from endpoint 0x${endpointAddr?.toString(16) || '??'}`)

        if (this.isWebEnvironment) {
            const transferSize = Math.min(maxLength, USB_LIMITS.MAX_WEBUSB_TRANSFER)
            
            const result = await this.device.transferIn(this.endpoints.bulkIn.endpointNumber, transferSize)
            if (result.status !== 'ok') {
                throw new Error(`Transfer failed: ${result.status}`)
            }
            console.log(`USB Transport: Received ${result.data.byteLength} bytes`)
            return toUint8Array(result.data.buffer)
        } else {
            return this.receiveNodeUSB(maxLength)
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

        if (!this.isWebEnvironment) {
            // Node USB reset
            try {
                this.device.reset()
            } catch {
                // Ignore reset errors
            }
        }
        // WebUSB doesn't have a reset method
    }

    /**
     * Get transport type
     */
    getType(): TransportType {
        return TransportType.USB
    }

    /**
     * Get connected device information
     */
    getDeviceInfo(): DeviceDescriptor | null {
        return this.deviceInfo
    }

    private async connectWebUSB(): Promise<void> {
        await this.device.open()

        // Configure endpoints
        const config = await this.endpointManager.configureEndpoints(this.device)
        this.endpoints = config

        // Find the interface number from the endpoint configuration
        const configuration = this.device.configuration || this.device.configurations[0]
        for (const intf of configuration.interfaces) {
            const alt = intf.alternates[0]
            if (alt.interfaceClass === 6 && alt.interfaceSubclass === 1) {
                this.interface = intf
                await this.device.claimInterface(intf.interfaceNumber)
                break
            }
        }

        if (!this.interface) {
            throw new Error('Failed to claim PTP interface')
        }
    }

    private async connectNodeUSB(): Promise<void> {
        this.device.open()

        // Configure endpoints (this also claims the interface)
        const config = await this.endpointManager.configureEndpoints(this.device)
        this.endpoints = config
    }

    /**
     * Send data using Node.js USB with proper error handling
     */
    private async sendNodeUSB(buffer: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`USB Transport: Calling transfer with ${buffer.length} bytes`)
            
            this.endpoints.bulkOut.transfer(buffer, async (error: any) => {
                console.log(`USB Transport: Transfer callback, error: ${error}`)
                
                if (!error) {
                    resolve()
                    return
                }

                // Check if this is a stall error
                if (this.isStallError(error)) {
                    try {
                        await this.handleStallError(EndpointType.BULK_OUT)
                        // Retry the transfer once
                        await this.retryTransfer(buffer)
                        resolve()
                    } catch (retryError) {
                        reject(retryError)
                    }
                } else {
                    reject(error)
                }
            })
        })
    }

    /**
     * Receive data using Node.js USB with proper error handling
     */
    private async receiveNodeUSB(maxLength: number): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                console.log('USB Transport: Receive timeout')
                reject(new Error('USB receive timeout'))
            }, USB_LIMITS.RECEIVE_TIMEOUT)

            console.log(`USB Transport: Calling transfer with maxLength ${maxLength}`)
            
            this.endpoints.bulkIn.transfer(maxLength, async (error: any, data: Buffer) => {
                clearTimeout(timeout)
                console.log(`USB Transport: Receive callback, error: ${error}, data length: ${data?.length || 0}`)
                
                if (!error) {
                    console.log(`USB Transport: Successfully received ${data.length} bytes`)
                    resolve(toUint8Array(data))
                    return
                }

                // Check if this is a stall error
                if (this.isStallError(error)) {
                    try {
                        await this.handleStallError(EndpointType.BULK_IN)
                        // Retry the receive once
                        const retryData = await this.retryReceive(maxLength)
                        resolve(retryData)
                    } catch (retryError) {
                        reject(retryError)
                    }
                } else {
                    reject(error)
                }
            })
        })
    }

    /**
     * Check if error is a stall/pipe error
     */
    private isStallError(error: any): boolean {
        return error.errno === -9 || 
               error.errno === 4 || 
               error.message?.includes('PIPE') || 
               error.message?.includes('STALL')
    }

    /**
     * Handle stall error by clearing halt
     */
    private async handleStallError(endpointType: EndpointType): Promise<void> {
        console.log(`USB Transport: Clearing halt on ${endpointType === EndpointType.BULK_IN ? 'IN' : 'OUT'} endpoint`)
        await this.endpointManager.clearHalt(endpointType)
        console.log('USB Transport: Halt cleared')
    }

    /**
     * Retry a send transfer after error
     */
    private async retryTransfer(buffer: Buffer): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log('USB Transport: Retrying transfer...')
            this.endpoints.bulkOut.transfer(buffer, (error: any) => {
                if (error) {
                    console.log(`USB Transport: Retry failed: ${error}`)
                    reject(error)
                } else {
                    console.log('USB Transport: Retry successful')
                    resolve()
                }
            })
        })
    }

    /**
     * Retry a receive transfer after error
     */
    private async retryReceive(maxLength: number): Promise<Uint8Array> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('USB receive retry timeout'))
            }, USB_LIMITS.RECEIVE_TIMEOUT)

            console.log('USB Transport: Retrying receive...')
            this.endpoints.bulkIn.transfer(maxLength, (error: any, data: Buffer) => {
                clearTimeout(timeout)
                if (error) {
                    console.log(`USB Transport: Retry failed: ${error}`)
                    reject(error)
                } else {
                    console.log(`USB Transport: Retry received ${data?.length || 0} bytes`)
                    resolve(toUint8Array(data))
                }
            })
        })
    }
}
