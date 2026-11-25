import type { CameraCapabilities, OperationAvailability } from '@camera/controls'
import type { CameraDriverCapabilities, CapabilityArea } from '@camera/driver/contract'
import type { Camera } from '@camera/index'
import { driverCapabilities } from '@camera/operations/context'
import { cameraOperationTable, publicOperations, type CameraOperationName, type OperationArea } from '@camera/operations/table'

/** The capability group behind each operation-table area that has one. */
const areaCapabilities: Partial<Record<OperationArea, CapabilityArea>> = {
    connection: 'connection',
    focus: 'focus',
    zoom: 'zoom',
    photo: 'photo',
    'live-view': 'liveView',
    video: 'video',
    media: 'media',
    body: 'body',
}

let checked: { name: CameraOperationName; area: CapabilityArea }[] | undefined

/** The implemented public operations in an area with a capability group, from the operation table. */
function checkedOperations() {
    checked ??= publicOperations().flatMap(operation => {
        const area = areaCapabilities[operation.entry.area]
        return operation.implemented && area && isCameraOperation(operation.name) ? [{ name: operation.name, area }] : []
    })
    return checked
}

const cameraOperationNames = new Set<string>(Object.keys(cameraOperationTable))
function isCameraOperation(name: string): name is CameraOperationName {
    return cameraOperationNames.has(name)
}

type AvailabilityReport = Partial<Record<string, OperationAvailability>>
type AvailabilityReporter = {
    availability(capabilities: CameraCapabilities): AvailabilityReport | Promise<AvailabilityReport>
}

function reportsAvailability(
    group: CameraDriverCapabilities[CapabilityArea]
): group is NonNullable<typeof group> & AvailabilityReporter {
    return typeof group === 'object' && group !== null && 'availability' in group && typeof group.availability === 'function'
}

/**
 * `getCapabilities().operations`: for each public operation Camera implements in an area with a
 * capability group, whether it can run now and why not. An absent group means the camera cannot.
 * A group that reports availability judges from the settings observation just made; one whose own
 * check fails leaves its operations unreported, and never fails getCapabilities.
 */
export async function readOperationAvailability(
    camera: Camera,
    capabilities: CameraCapabilities
): Promise<Partial<Record<CameraOperationName, OperationAvailability>>> {
    const groups = driverCapabilities(camera)
    const reported: AvailabilityReport = {}
    const unreported = new Set<CapabilityArea>()
    for (const [area, group] of Object.entries(groups) as [CapabilityArea, CameraDriverCapabilities[CapabilityArea]][]) {
        if (!reportsAvailability(group)) continue
        try {
            Object.assign(reported, await group.availability(capabilities))
        } catch {
            unreported.add(area)
        }
    }
    const availability: Partial<Record<CameraOperationName, OperationAvailability>> = {}
    for (const operation of checkedOperations()) {
        if (unreported.has(operation.area)) continue
        availability[operation.name] = groups[operation.area]
            ? (reported[operation.name] ?? { supported: true })
            : { supported: false, reason: `${operation.name} is not supported by this camera` }
    }
    return availability
}
