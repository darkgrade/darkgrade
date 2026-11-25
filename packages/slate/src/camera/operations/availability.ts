import type { OperationAvailability } from '@camera/controls'
import type { CapabilityArea } from '@camera/driver/contract'
import type { Camera } from '@camera/index'
import { driverCapabilities } from '@camera/operations/context'
import type { CameraOperationName } from '@camera/operations/table/index'

/**
 * The public operations whose availability follows from a capability group. Each area appends its
 * operations as they land; an operation is available when its group exists and the group does not
 * name it in `unavailableOperations()`.
 */
const operationsByCapability: Partial<Record<CapabilityArea, readonly CameraOperationName[]>> = {
    connection: ['getInfo'],
    media: ['getCardStatus', 'listMedia', 'getMediaPreview', 'downloadMedia'],
    body: ['getBattery', 'setClock'],
}

/** Which of those operations this camera can do right now, and why not. Reads nothing it need not. */
export async function readOperationAvailability(
    camera: Camera
): Promise<Partial<Record<CameraOperationName, OperationAvailability>>> {
    const groups = driverCapabilities(camera)
    const availability: Partial<Record<CameraOperationName, OperationAvailability>> = {}
    for (const [area, operations] of Object.entries(operationsByCapability) as [CapabilityArea, readonly CameraOperationName[]][]) {
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
            availability[operation] = reason ? { available: false, reason } : { available: true }
        }
    }
    return availability
}
