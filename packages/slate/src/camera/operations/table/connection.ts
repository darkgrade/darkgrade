import type { AreaOperationTable } from '@camera/operations/table/operation-entry'

/**
 * The connection area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const connectionOperationTable = {
    current: {
        connect: {
            area: 'connection',
            disposition: { kind: 'keep' },
            summary: 'Opens the camera. observeOnly reads without changing any setting',
            surfaces: {
                cli: { omitted: 'every command connects itself' },
            },
        },
        getInfo: {
            area: 'connection',
            disposition: { kind: 'keep' },
            summary: 'Make, model, firmware, lens mount, connection type',
        },
        connectSonyMenuSession: {
            area: 'connection',
            disposition: { kind: 'protocol' },
        },
        connectSonyObservationSession: {
            area: 'connection',
            disposition: { kind: 'replaced-by', target: 'connect', note: 'connect({ observeOnly: true })' },
        },
        recover: {
            area: 'connection',
            disposition: { kind: 'keep' },
            summary: 'Unsticks a camera that stopped answering',
        },
        disconnect: {
            area: 'connection',
            disposition: { kind: 'keep' },
            summary: 'Closes the camera and puts it back the way it was',
            surfaces: {
                cli: { omitted: 'every command disconnects itself' },
            },
        },
    },
    planned: {},
} as const satisfies AreaOperationTable

/** Static methods on Camera, checked against `typeof Camera`. */
export const connectionStaticOperationTable = {
    discover: {
        area: 'connection',
        disposition: { kind: 'keep' },
        summary: 'Lists attached cameras without opening one',
        // The one exception to the naming rule: it lists cameras rather than acting on one.
        surfaces: { cli: { topLevelCommand: 'cameras' } },
    },
} as const satisfies AreaOperationTable['current']
