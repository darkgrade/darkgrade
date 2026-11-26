import type { Transaction } from '#telemetry-server/database'
import { randomUUID } from 'node:crypto'

/** Invalidates an in-progress export when review, withdrawal or attribution changes. */
export function changeMatrixGeneration(transaction: Transaction) {
    transaction.set('maintenance/matrix-generation', { value: randomUUID() })
}
