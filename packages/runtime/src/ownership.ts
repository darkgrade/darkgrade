import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { HardwareBusyError } from './errors.ts'
export interface OwnershipStore {
    claimHardwareResource(resource: string, owner: string, purpose: string, lifetimeMilliseconds: number): boolean
    heartbeatHardwareOwner(owner: string, lifetimeMilliseconds: number): unknown
    releaseHardwareOwner(owner: string): unknown
    hardwareOwners(): unknown[]
}
interface Context {
    owner: string
    resources: Set<string>
}
/** Cross-process camera ownership, with reentrant nested calls on the same operation. */
export class HardwareCoordinator {
    private readonly context = new AsyncLocalStorage<Context>()
    constructor(private readonly database: OwnershipStore) {}
    get owner() {
        return this.context.getStore()?.owner
    }
    claim(resource: string, purpose: string) {
        const owner = randomUUID()
        if (!this.database.claimHardwareResource(resource, owner, purpose, 45000))
            throw new HardwareBusyError('This camera input is already owned by another operation')
        const heartbeat = setInterval(() => this.database.heartbeatHardwareOwner(owner, 45000), 10000)
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
        if (existing?.resources.has(resource)) return operation()
        const context = existing || { owner: randomUUID(), resources: new Set<string>() }
        const acquire = async () => {
            const deadline = Date.now() + waitMilliseconds
            while (!this.database.claimHardwareResource(resource, context.owner, purpose, 45000)) {
                if (Date.now() >= deadline)
                    throw new HardwareBusyError(
                        'Camera is in use by another operation; waiting did not finish. No USB or power reset was attempted.'
                    )
                await new Promise(resolve => setTimeout(resolve, 50))
            }
            context.resources.add(resource)
        }
        if (existing) {
            await acquire()
            return operation()
        }
        return this.context.run(context, async () => {
            await acquire()
            const heartbeat = setInterval(() => this.database.heartbeatHardwareOwner(context.owner, 45000), 10000)
            try {
                return await operation()
            } finally {
                clearInterval(heartbeat)
                this.database.releaseHardwareOwner(context.owner)
            }
        })
    }
}
