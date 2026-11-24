import { Logger } from '@core/logger'
import type { VendorOperationRegistry } from '@ptp/registry'
import { TransportInterface } from '@transport/interfaces/transport.interface'
import { GenericCamera } from './generic-camera'

/**
 * A camera from a vendor whose darkgrade support is limited to cited vendor operation definitions
 * (Fujifilm, Panasonic, OM System/Olympus, Leica, Sigma). It behaves exactly like GenericCamera; the
 * vendor registry only makes the vendor operations available to `send()` and to logging.
 */
export class VendorExtensionCamera extends GenericCamera {
    declare public registry: VendorOperationRegistry

    constructor(transport: TransportInterface, logger: Logger, registry: VendorOperationRegistry, vendorId: number) {
        super(transport, logger)
        this.registry = registry
        this.vendorId = vendorId
        logger.setRegistry(this.registry)
    }
}
