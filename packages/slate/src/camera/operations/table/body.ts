import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The body area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const bodyOperationTable = {
    current: {
        setSonyDateTime: {
            area: 'body',
            disposition: { kind: 'replaced-by', target: 'setClock' },
        },
        keepDeviceOn: {
            area: 'body',
            disposition: { kind: 'private', handledBy: 'connect (the keep-alive heartbeat)' },
        },
    },
    planned: {
        getBattery: {
            area: 'body',
            disposition: { kind: 'add' },
            summary: 'Level, minutes left, and whether it\'s on battery, USB or DC power',
        },
        setClock: {
            area: 'body',
            disposition: { kind: 'add' },
            summary: 'Sets the camera\'s date and time',
        },
    },
} as const satisfies AreaOperationTable
