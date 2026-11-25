import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { join } from 'node:path'
import type { OwnershipStore } from '@runtime/ownership'

/** Where separate checkouts and worktrees on one computer share camera leases. */
export const defaultLeaseDirectory = join(homedir(), '.darkgrade', 'leases')

export interface HardwareClaim {
    resource: string
    owner: string
    purpose: string
    host: string
    /** The process that claimed the resource and keeps its heartbeat. */
    processId: number
    /** Processes started under the claim; any of them alive keeps the claim. */
    childProcessIds: number[]
    claimedAt: number
    expiresAt: number
}

interface StoredClaims {
    claims: Record<string, HardwareClaim>
}

const mutexWaitMilliseconds = 5000
const staleMutexMilliseconds = 10000

function sleepSynchronously(milliseconds: number) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

function processAlive(processId: number): boolean {
    try {
        process.kill(processId, 0)
        return true
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}

/**
 * A file-backed OwnershipStore for HardwareCoordinator, shared by every process on this computer.
 * A claim lives while its heartbeat is current and its process runs, or while a child process it
 * started still runs; a process killed outright therefore frees its claim at once.
 */
export class FileOwnershipStore implements OwnershipStore {
    private readonly statePath: string
    private readonly mutexPath: string

    constructor(readonly directory: string = process.env.DARKGRADE_LEASE_DIRECTORY || defaultLeaseDirectory) {
        mkdirSync(directory, { recursive: true, mode: 0o700 })
        this.statePath = join(directory, 'hardware-owners.json')
        this.mutexPath = join(directory, 'hardware-owners.lock')
    }

    claimHardwareResource(resource: string, owner: string, purpose: string, lifetimeMilliseconds: number): boolean {
        return this.update(state => {
            const existing = state.claims[resource]
            if (existing && existing.owner !== owner) return false
            const now = Date.now()
            state.claims[resource] = {
                resource,
                owner,
                purpose,
                host: hostname(),
                processId: process.pid,
                childProcessIds: existing?.childProcessIds ?? [],
                claimedAt: existing?.claimedAt ?? now,
                expiresAt: now + lifetimeMilliseconds,
            }
            return true
        })
    }

    heartbeatHardwareOwner(owner: string, lifetimeMilliseconds: number): number {
        return this.update(state => {
            const owned = Object.values(state.claims).filter(claim => claim.owner === owner)
            for (const claim of owned) claim.expiresAt = Date.now() + lifetimeMilliseconds
            return owned.length
        })
    }

    releaseHardwareOwner(owner: string): number {
        return this.update(state => {
            const owned = Object.values(state.claims).filter(claim => claim.owner === owner)
            for (const claim of owned) delete state.claims[claim.resource]
            return owned.length
        })
    }

    /** Records a process started under the owner's claims, so an orphaned child still holds them. */
    attachChildProcess(owner: string, childProcessId: number): void {
        this.update(state => {
            for (const claim of Object.values(state.claims))
                if (claim.owner === owner && !claim.childProcessIds.includes(childProcessId))
                    claim.childProcessIds.push(childProcessId)
        })
    }

    hardwareOwners(): HardwareClaim[] {
        return this.update(state => Object.values(state.claims))
    }

    private claimLive(claim: HardwareClaim, now: number): boolean {
        if (claim.host !== hostname()) return claim.expiresAt > now
        if (claim.childProcessIds.some(processAlive)) return true
        return claim.expiresAt > now && processAlive(claim.processId)
    }

    private update<T>(change: (state: StoredClaims) => T): T {
        this.lock()
        try {
            const state = this.read()
            const now = Date.now()
            for (const claim of Object.values(state.claims))
                if (!this.claimLive(claim, now)) delete state.claims[claim.resource]
            const result = change(state)
            const temporaryPath = `${this.statePath}.${process.pid}.tmp`
            writeFileSync(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 })
            renameSync(temporaryPath, this.statePath)
            return result
        } finally {
            rmSync(this.mutexPath, { recursive: true, force: true })
        }
    }

    private read(): StoredClaims {
        try {
            const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<StoredClaims>
            return { claims: parsed.claims && typeof parsed.claims === 'object' ? parsed.claims : {} }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { claims: {} }
            throw new Error(`Unreadable camera lease file ${this.statePath}; inspect it before removing it`, {
                cause: error,
            })
        }
    }

    // mkdir is atomic across processes; the directory is held for one read-modify-write only.
    private lock() {
        const deadline = Date.now() + mutexWaitMilliseconds
        for (;;) {
            try {
                mkdirSync(this.mutexPath)
                return
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            }
            if (this.mutexStale()) rmSync(this.mutexPath, { recursive: true, force: true })
            else if (Date.now() >= deadline) throw new Error(`Camera lease file stayed locked: ${this.mutexPath}`)
            else sleepSynchronously(5)
        }
    }

    private mutexStale(): boolean {
        try {
            return Date.now() - statSync(this.mutexPath).mtimeMs > staleMutexMilliseconds
        } catch {
            return false
        }
    }
}
