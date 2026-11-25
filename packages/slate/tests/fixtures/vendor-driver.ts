import type { GenericCamera } from '@camera/generic-camera'
import type { Camera } from '@camera/index'
import { protocolSession } from '@camera/operations/protocol'

/** The Camera's current driver as the vendor class a test expects, or a failure naming both. */
export function vendorDriver<Driver extends GenericCamera>(
    camera: Camera,
    kind: abstract new (...parameters: never[]) => Driver
): Driver {
    const driver = protocolSession(camera).driver
    if (!(driver instanceof kind)) throw new Error(`Expected a ${kind.name} driver, found ${driver.constructor.name}`)
    return driver
}
