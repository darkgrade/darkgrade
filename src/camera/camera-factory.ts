import { TransportInterface } from '@transport/interfaces/transport.interface'
import { ProtocolInterface } from '@core/protocol'
import { MessageBuilderInterface, MessageParserInterface } from '@core/messages'
import { PTPMessageBuilder } from '@core/messages'
import { PTPProtocol } from '@core/protocol'
import { CameraInterface } from '@camera/interfaces/camera.interface'
import { GenericPTPCamera } from '@camera/generic/generic-ptp-camera'
import { SonyCamera } from '@camera/vendors/sony/camera'
import { SonyAuthenticator } from '@camera/vendors/sony/authenticator'
import { VendorIDs } from '@constants/vendors/vendor-ids'
import { LoggerInterface } from '@core/logger'

/**
 * No-op logger for environments without logging support (e.g., browser)
 */
class NoOpLogger implements LoggerInterface {
    addLog(): number {
        return -1
    }
    updateEntry(): number {
        return -1
    }
}

/**
 * Camera factory for creating camera implementations
 * V7 Architecture - Direct constant usage without mappers
 */
export class CameraFactory {
    private logger: LoggerInterface = new NoOpLogger()
    /**
     * Create a Sony camera instance
     * @param transport - Transport interface
     */
    createSonyCamera(transport: TransportInterface): CameraInterface {
        const messageBuilder = this.createMessageBuilder()
        const protocol = this.createProtocol(transport, messageBuilder)
        const authenticator = new SonyAuthenticator()
        return new SonyCamera(protocol, authenticator)
    }

    /**
     * Create a Canon camera instance
     * @param transport - Transport interface
     */
    createCanonCamera(transport: TransportInterface): CameraInterface {
        // TODO: Implement Canon-specific camera when needed
        // For now, use generic PTP
        return this.createGenericCamera(transport)
    }

    /**
     * Create a Nikon camera instance
     * @param transport - Transport interface
     */
    createNikonCamera(transport: TransportInterface): CameraInterface {
        // TODO: Implement Nikon-specific camera when needed
        // For now, use generic PTP
        return this.createGenericCamera(transport)
    }

    /**
     * Create a generic PTP camera instance
     * @param transport - Transport interface
     */
    createGenericCamera(transport: TransportInterface): CameraInterface {
        const messageBuilder = this.createMessageBuilder()
        const protocol = this.createProtocol(transport, messageBuilder)
        return new GenericPTPCamera(protocol)
    }

    /**
     * Create a camera instance by vendor
     * @param vendor - Vendor name
     * @param transport - Transport interface
     */
    create(vendor: string, transport: TransportInterface): CameraInterface {
        const normalizedVendor = vendor.toLowerCase()

        switch (normalizedVendor) {
            case 'sony':
                return this.createSonyCamera(transport)
            case 'canon':
                return this.createCanonCamera(transport)
            case 'nikon':
                return this.createNikonCamera(transport)
            case 'fuji':
            case 'fujifilm':
                // TODO: Implement Fujifilm-specific camera when needed
                return this.createGenericCamera(transport)
            case 'panasonic':
                // TODO: Implement Panasonic-specific camera when needed
                return this.createGenericCamera(transport)
            case 'olympus':
                // TODO: Implement Olympus-specific camera when needed
                return this.createGenericCamera(transport)
            default:
                return this.createGenericCamera(transport)
        }
    }

    /**
     * Detect vendor from device info
     * @param vendorId - USB vendor ID
     * @param productId - USB product ID
     */
    detectVendor(vendorId: number, _productId?: number): string {
        switch (vendorId) {
            case VendorIDs.SONY:
                return 'sony'
            case VendorIDs.CANON:
                return 'canon'
            case VendorIDs.NIKON:
                return 'nikon'
            case VendorIDs.FUJIFILM:
                return 'fujifilm'
            case VendorIDs.PANASONIC:
                return 'panasonic'
            case VendorIDs.OLYMPUS:
                return 'olympus'
            default:
                return 'generic'
        }
    }

    /**
     * Create camera automatically based on vendor ID
     * @param transport - Transport interface
     * @param vendorId - USB vendor ID
     * @param productId - USB product ID
     */
    createAuto(transport: TransportInterface, vendorId: number, productId?: number): CameraInterface {
        const vendor = this.detectVendor(vendorId, productId)
        return this.create(vendor, transport)
    }

    /**
     * Create a message builder for PTP protocol
     */
    protected createMessageBuilder(): MessageBuilderInterface & MessageParserInterface {
        return new PTPMessageBuilder()
    }

    /**
     * Create a protocol instance
     * @param transport - Transport interface
     * @param messageBuilder - Message builder
     */
    protected createProtocol(
        transport: TransportInterface,
        messageBuilder: MessageBuilderInterface & MessageParserInterface
    ): ProtocolInterface {
        return new PTPProtocol(transport, messageBuilder, this.logger)
    }
}
