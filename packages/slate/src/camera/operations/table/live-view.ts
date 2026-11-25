import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The live-view area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const liveViewOperationTable = {
    current: {
        getLiveViewFrame: {
            area: 'live-view',
            disposition: { kind: 'keep' },
            summary: 'The current picture as JPEG, with focus frames and, with overlay, the camera\'s on-screen info',
            parameters: [{ name: 'overlay', type: 'switch', default: false, description: 'include the camera\'s on-screen info' }],
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
