import { TransportInterface, TransportType, DeviceIdentifier } from '@transport/interfaces/transport.interface'
import { EndpointManagerInterface, EndpointType, DeviceFinderInterface } from '@transport/interfaces/endpoint.interface'

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
    async connect(deviceIdentifier: DeviceIdentifier): Promise<void> {
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

        const buffer = Buffer.from(data)
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
            return new Promise((resolve, reject) => {
                const handleTransfer = (error: any) => {
                    console.log(`USB Transport: Transfer callback, error: ${error}`)
                    if (error) {
                        this.handleNodeUSBError(error, buffer, resolve, reject)
                    } else {
                        resolve()
                    }
                }

                console.log(`USB Transport: Calling transfer with ${buffer.length} bytes`)
                this.endpoints.bulkOut.transfer(buffer, handleTransfer)
            })
        }
    }

    /**
     * Receive data from the device
     */
    async receive(maxLength: number = 8192): Promise<Uint8Array> {
        if (!this.connected || !this.endpoints) {
            throw new Error('Not connected')
        }

        const endpointAddr = this.isWebEnvironment 
            ? this.endpoints.bulkIn.endpointNumber 
            : (this.endpoints.bulkIn as any).descriptor?.bEndpointAddress
        console.log(`USB Transport: Receiving up to ${maxLength} bytes from endpoint 0x${endpointAddr?.toString(16) || '??'}`)

        if (this.isWebEnvironment) {
            // WebUSB has a 32MB limit per transfer, so cap it
            const MAX_WEBUSB_TRANSFER = 32 * 1024 * 1024 - 1024; // 32MB minus 1KB for safety
            const transferSize = Math.min(maxLength, MAX_WEBUSB_TRANSFER)
            
            const result = await this.device.transferIn(this.endpoints.bulkIn.endpointNumber, transferSize)
            if (result.status !== 'ok') {
                throw new Error(`Transfer failed: ${result.status}`)
            }
            console.log(`USB Transport: Received ${result.data.byteLength} bytes`)
            return new Uint8Array(result.data.buffer)
        } else {
            return new Promise((resolve, reject) => {
                // Add timeout to prevent hanging forever
                const timeout = setTimeout(() => {
                    console.log('USB Transport: Receive timeout after 5 seconds')
                    reject(new Error('USB receive timeout'))
                }, 5000)

                const handleReceive = (error: any, data: Buffer) => {
                    clearTimeout(timeout)
                    console.log(`USB Transport: Receive callback, error: ${error}, data length: ${data?.length || 0}`)
                    if (error) {
                        // Handle stall on receive
                        if (error.errno === 4 || error.errno === -9 || error.message?.includes('STALL')) {
                            console.log('USB receive stall detected, clearing halt...')
                            this.endpointManager
                                .clearHalt(EndpointType.BULK_IN)
                                .then(() => {
                                    console.log('USB receive halt cleared, retrying...')
                                    const retryTimeout = setTimeout(() => {
                                        console.log('USB Transport: Retry receive timeout')
                                        reject(new Error('USB receive retry timeout'))
                                    }, 5000)
                                    this.endpoints.bulkIn.transfer(maxLength, (retryError: any, retryData: Buffer) => {
                                        clearTimeout(retryTimeout)
                                        if (retryError) {
                                            reject(retryError)
                                        } else {
                                            console.log(`USB Transport: Retry received ${retryData?.length || 0} bytes`)
                                            resolve(new Uint8Array(retryData))
                                        }
                                    })
                                })
                                .catch(() => {
                                    reject(error)
                                })
                        } else {
                            reject(error)
                        }
                    } else {
                        console.log(`USB Transport: Successfully received ${data.length} bytes`)
                        resolve(new Uint8Array(data))
                    }
                }
                console.log(`USB Transport: Calling transfer with maxLength ${maxLength}`)
                this.endpoints.bulkIn.transfer(maxLength, handleReceive)
            })
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
    getDeviceInfo(): DeviceIdentifier | null {
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

    private handleNodeUSBError(
        error: any,
        buffer: Buffer,
        resolve: (value: void | PromiseLike<void>) => void,
        reject: (reason?: any) => void
    ): void {
        // Handle stall/pipe errors with retry
        console.log(`USB Transport: Handling error - errno: ${error.errno}, message: ${error.message}`)
        if (
            error.errno === -9 ||
            error.errno === 4 ||
            error.message?.includes('PIPE') ||
            error.message?.includes('STALL')
        ) {
            console.log('USB Transport: Clearing halt and retrying...')
            // Clear halt and retry
            this.endpointManager
                .clearHalt(EndpointType.BULK_OUT)
                .then(() => {
                    console.log('USB Transport: Halt cleared, retrying transfer...')
                    // Retry once after clearing
                    this.endpoints.bulkOut.transfer(buffer, (retryError: any) => {
                        if (retryError) {
                            console.log(`USB Transport: Retry failed: ${retryError}`)
                            reject(retryError)
                        } else {
                            console.log('USB Transport: Retry successful!')
                            resolve()
                        }
                    })
                })
                .catch(clearError => {
                    console.log(`USB Transport: Failed to clear halt: ${clearError}`)
                    reject(error)
                })
        } else {
            reject(error)
        }
    }
}
