import type { AreaOperationTable } from '@camera/operation-table/operation-entry'

/**
 * The protocol area's operations. `current` lists every method on Camera today with its
 * disposition; `planned` lists target operations not on Camera yet. When one lands, move its entry
 * from `planned` to `current` (the compiler fails until the table and Camera agree).
 */
export const protocolOperationTable = {
    // Protocol access left Camera for protocolSession(camera), from @darkgrade/slate/protocol.
    current: {},
    planned: {},
} as const satisfies AreaOperationTable
