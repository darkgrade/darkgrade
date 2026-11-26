import { AsyncLocalStorage } from 'node:async_hooks'
import { HardwareBusyError } from '@runtime/errors'

/** How long a claim lasts without a heartbeat, how often a held claim is renewed, and how often a waiting call retries. */
export const OWNERSHIP_LEASE_MILLISECONDS = 45000
export const OWNERSHIP_HEARTBEAT_MILLISECONDS = 10000
const CLAIM_RETRY_MILLISECONDS = 50
export interface OwnershipStore {
    claimHardwareResource(resource: string, owner: string, purpose: string, lifetimeMilliseconds: number): boolean
    heartbeatHardwareOwner(owner: string, lifetimeMilliseconds: number): unknown
    releaseHardwareOwner(owner: string): unknown
    hardwareOwners(): unknown[]
}
interface Context {
    owner: string
    resources: Set<string>
    operations: number
    heartbeat?: ReturnType<typeof setInterval>
}
/** Cross-process camera ownership, with reentrant nested calls on the same operation. */
export class HardwareCoordinator {
    private readonly context = new AsyncLocalStorage<Context>()
    constructor(private readonly database: OwnershipStore) {}
    get owner() {
        const context = this.context.getStore()
        return context?.operations ? context.owner : undefined
    }
    claim(resource: string, purpose: string) {
        const owner = crypto.randomUUID()
        if (!this.database.claimHardwareResource(resource, owner, purpose, OWNERSHIP_LEASE_MILLISECONDS))
            throw new HardwareBusyError('This camera input is already owned by another operation')
        const heartbeat = setInterval(() => this.database.heartbeatHardwareOwner(owner, OWNERSHIP_LEASE_MILLISECONDS), OWNERSHIP_HEARTBEAT_MILLISECONDS)
        let released = false
        return {
            release: () => {
                if (released) return
                released = true
                clearInterval(heartbeat)
                this.database.releaseHardwareOwner(owner)
            },
        }
    }
    async lease(resource: string, purpose: string) {
        return this.claim(resource, purpose)
    }
    owners() {
        return this.database.hardwareOwners()
    }
    async run<T>(resource: string, purpose: string, operation: () => Promise<T>, waitMilliseconds = 15000): Promise<T> {
        const existing = this.context.getStore()
        const context: Context = existing?.operations ? existing : { owner: crypto.randomUUID(), resources: new Set<string>(), operations: 0 }
        // Count before acquisition: a sibling can finish while this call waits.
        context.operations++
        const acquire = async () => {
            if (context.resources.has(resource)) {
                if (!this.database.claimHardwareResource(resource, context.owner, purpose, OWNERSHIP_LEASE_MILLISECONDS))
                    throw new HardwareBusyError(
                        'Camera ownership expired or changed; no further command was sent. Inspect the current owner before retrying.'
                    )
                return
            }
            const deadline = Date.now() + waitMilliseconds
            while (!this.database.claimHardwareResource(resource, context.owner, purpose, OWNERSHIP_LEASE_MILLISECONDS)) {
                if (Date.now() >= deadline)
                    throw new HardwareBusyError(
                        'Camera is in use by another operation; waiting did not finish. No USB or power reset was attempted.'
                    )
                await new Promise(resolve => setTimeout(resolve, CLAIM_RETRY_MILLISECONDS))
            }
            context.resources.add(resource)
            context.heartbeat ??= setInterval(() => this.database.heartbeatHardwareOwner(context.owner, OWNERSHIP_LEASE_MILLISECONDS), OWNERSHIP_HEARTBEAT_MILLISECONDS)
        }
        return this.context.run(context, async () => {
            try {
                await acquire()
                return await operation()
            } finally {
                context.operations--
                if (!context.operations) {
                    clearInterval(context.heartbeat)
                    this.database.releaseHardwareOwner(context.owner)
                }
            }
        })
    }
}
