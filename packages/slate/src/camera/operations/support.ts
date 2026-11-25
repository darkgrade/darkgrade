import type { OperationSupport } from '@camera/controls'
import type { CameraDriverCapabilities, CapabilityArea } from '@camera/driver/contract'
import type { Camera } from '@camera/index'
import { driverCapabilities } from '@camera/operations/context'
import { publicOperations, type OperationArea } from '@camera/operations/table'

/** The capability group behind each operation-table area that has one. */
const areaCapabilities: Partial<Record<OperationArea, CapabilityArea>> = {
    focus: 'focus',
    zoom: 'zoom',
    photo: 'photo',
    'live-view': 'liveView',
    video: 'video',
    media: 'media',
    body: 'body',
}

let checked: { name: string; area: OperationArea }[] | undefined

/** The implemented public operations, from the operation table; computed once. */
function checkedOperations() {
    checked ??= publicOperations()
        .filter(operation => operation.implemented)
        .map(operation => ({ name: operation.name, area: operation.entry.area }))
    return checked
}

type SupportReporter = { support(): Partial<Record<string, OperationSupport>> }

function reportsSupport(
    group: CameraDriverCapabilities[CapabilityArea]
): group is NonNullable<typeof group> & SupportReporter {
    return typeof group === 'object' && group !== null && 'support' in group && typeof group.support === 'function'
}

/**
 * `getCapabilities().operations`: for each public operation Camera implements in an area with a
 * capability group, whether it can run now. An absent group means the camera cannot; a group that
 * reports support says so from the observation just read, without sending anything.
 */
export function operationSupport(camera: Camera): Partial<Record<string, OperationSupport>> {
    const groups = driverCapabilities(camera)
    const reported: Partial<Record<string, OperationSupport>> = {}
    for (const group of Object.values(groups)) if (reportsSupport(group)) Object.assign(reported, group.support())
    const support: Partial<Record<string, OperationSupport>> = {}
    for (const operation of checkedOperations()) {
        const area = areaCapabilities[operation.area]
        if (!area) continue
        support[operation.name] = groups[area]
            ? (reported[operation.name] ?? { supported: true })
            : { supported: false, reason: `${operation.name} is not supported by this camera` }
    }
    return support
}
