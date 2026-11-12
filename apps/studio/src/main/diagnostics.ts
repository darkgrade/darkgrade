import { createApplicationDiagnostics } from '@darkgrade/contribute/application'
import { installationFileStore } from '@darkgrade/contribute/installation-store'
import {
    closeNodeDiagnostics,
    nodeDiagnostics,
    settingsDirectory,
    sharedSettings,
} from '@darkgrade/contribute/settings'
import type { DiagnosticsStatus } from '@shared/ipc'
import { app, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let client: Awaited<ReturnType<typeof createApplicationDiagnostics>> | undefined
let initializationError: string | null = null

export async function initializeDiagnostics() {
    try {
        // Preserve the unpublished previous Studio opt-out when moving to the shared CLI file.
        const endpoint = process.env.DARKGRADE_TELEMETRY_URL
        if (endpoint && !existsSync(join(settingsDirectory(), 'settings.json'))) {
            const identity = createHash('sha256').update(new URL(endpoint).origin).digest('hex').slice(0, 20)
            const legacy = join(app.getPath('userData'), `diagnostics-${identity}.bin`)
            if (existsSync(legacy)) {
                if (!safeStorage.isEncryptionAvailable()) throw new Error('Legacy settings cannot be read')
                const saved = await installationFileStore(legacy, {
                    encrypt: value => safeStorage.encryptString(value),
                    decrypt: value => safeStorage.decryptString(Buffer.from(value)),
                }).read()
                if (saved) {
                    const store = sharedSettings()
                    const initial = await store.read()
                    await store.write({
                        ...initial!,
                        ...saved,
                        installationId:
                            saved.installationId ?? saved.installKey?.slice(4, 40) ?? initial!.installationId,
                        ...(saved.installKey && { enrollmentKey: undefined }),
                    })
                }
            }
        }
        client = await nodeDiagnostics()
    } catch {
        initializationError = 'Telemetry settings could not be loaded.'
    }
}

export function diagnosticsStatus(): DiagnosticsStatus {
    return {
        configured: !!client && !!process.env.DARKGRADE_TELEMETRY_URL,
        enabled: false,
        enrolled: false,
        withdrawalPending: false,
        queuedEntries: 0,
        droppedEntries: 0,
        error: initializationError,
        ...client?.status(),
    }
}
export async function changeDiagnostics(action: string, value?: boolean) {
    if (!client) throw new Error('Diagnostics are not configured')
    if (action === 'sharing' && typeof value === 'boolean') await client.setConsent(value)
    else if (action === 'withdraw') await client.withdraw()
    else if (action === 'retry') await client.retryWithdrawal()
    else throw new Error('Invalid diagnostics action')
    return diagnosticsStatus()
}
export async function diagnosticsContact(action: string, email?: string, name?: string) {
    if (!client) throw new Error('Diagnostics are not configured')
    if (action === 'status') return client.contactStatus()
    if (action === 'remove') {
        await client.removeContact()
        return null
    }
    if (action === 'request' && typeof email === 'string') {
        await client.requestContact(email, name ? { name, publish: true } : undefined)
        return null
    }
    throw new Error('Invalid contact action')
}

export function closeDiagnostics() {
    client = undefined
    void closeNodeDiagnostics().catch(() => {})
}
