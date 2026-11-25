import type { CameraCapabilities, OperationAvailability } from '@camera/controls'
import type { CapabilityArea } from '@camera/driver/contract'
import type { Camera } from '@camera/index'
import { driverCapabilities } from '@camera/operations/context'

/**
 * The public operations whose availability follows from a capability group. Each area appends its
 * operations as they land; an operation is available when its group exists and the group does not
 * name it in `unavailableOperations()`.
 */
const operationsByCapability: Partial<Record<CapabilityArea, readonly string[]>> = {
    connection: ['getInfo'],
    media: ['getCardStatus', 'listMedia', 'getMediaPreview', 'downloadMedia'],
    body: ['getBattery', 'setClock'],
}

/**
 * Which operations this camera can do right now, and why not. Groups that judge from the settings
 * observation just made (focus) read nothing; the others read only what their check needs.
 */
export async function readOperationAvailability(
    camera: Camera,
    capabilities: CameraCapabilities
): Promise<Record<string, OperationAvailability>> {
    const groups = driverCapabilities(camera)
    const availability: Record<string, OperationAvailability> = { ...groups.focus?.availability(capabilities) }
    for (const [area, operations] of Object.entries(operationsByCapability) as [CapabilityArea, readonly string[]][]) {
        const group = groups[area]
        let unavailable: Partial<Record<string, string>> = {}
        try {
            if (group && 'unavailableOperations' in group && group.unavailableOperations)
                unavailable = await group.unavailableOperations()
        } catch {
            // An unreadable check leaves these operations unreported; it never fails getCapabilities.
            continue
        }
        for (const operation of operations) {
            const reason = group ? unavailable[operation] : `${operation} is not supported by this camera`
            availability[operation] = reason ? { supported: false, reason } : { supported: true }
        }
    }
    return availability
}
