import type { AreaOperationTable } from '@camera/operation-table/operation-entry'

/**
 * The events area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const eventsOperationTable = {
    current: {
        on: {
            area: 'events',
            disposition: { kind: 'keep' },
            summary: 'Called when a setting changes on the camera, or a new photo or clip lands',
            surfaces: {
                mcp: { omitted: 'callbacks can\'t cross a process' },
                cli: { omitted: 'callbacks can\'t cross a process' },
            },
        },
        off: {
            area: 'events',
            disposition: { kind: 'keep' },
            summary: 'Stops listening',
            surfaces: {
                mcp: { omitted: 'callbacks can\'t cross a process' },
                cli: { omitted: 'callbacks can\'t cross a process' },
            },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
