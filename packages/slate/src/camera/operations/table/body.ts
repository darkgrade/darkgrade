import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The body area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const bodyOperationTable = {
    current: {
        getBattery: {
            area: 'body',
            disposition: { kind: 'keep' },
            summary: 'Level, minutes left, and whether it\'s on battery, USB or DC power',
        },
        setClock: {
            area: 'body',
            disposition: { kind: 'keep' },
            summary: 'Sets the camera\'s date and time',
            surfaces: {
                cli: {
                    flags: [{ name: '--time', value: 'ISO 8601', description: 'the time to set (default: now)' }],
                },
            },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable
