import { createApplicationDiagnostics } from '@darkgrade/contribute/application'
import { installationFileStore } from '@darkgrade/contribute/installation-store'
import type { CameraContext } from '@darkgrade/contribute/schema'
import { TransportFactory } from '@darkgrade/link'
import type { DiagnosticsStatus } from '@shared/ipc'
import { app, dialog, safeStorage } from 'electron'
import { createHash } from 'node:crypto'
import { join } from 'node:path'

declare const __LINK_REVISION__: string
declare const __LINK_DIRTY__: boolean
let client: Awaited<ReturnType<typeof createApplicationDiagnostics>> | undefined
let initializationError: string | null = null

export async function initializeDiagnostics() {
    const endpoint = process.env.DARKGRADE_TELEMETRY_URL
    if (!endpoint) return
    try {
        if (
            !safeStorage.isEncryptionAvailable() ||
            (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
        )
            throw new Error('Secure storage unavailable')
        // Credentials cannot migrate to another configured collector origin.
        const identity = createHash('sha256').update(new URL(endpoint).origin).digest('hex').slice(0, 20)
        client = await createApplicationDiagnostics({
            endpoint,
            store: installationFileStore(join(app.getPath('userData'), `diagnostics-${identity}.bin`), {
                encrypt: value => safeStorage.encryptString(value),
                decrypt: value => safeStorage.decryptString(Buffer.from(value)),
            }),
            presentNotice: async notice => {
                const choice = await dialog.showMessageBox({
                    type: 'info',
                    title: 'Camera diagnostics',
                    message: 'Help improve Darkgrade Link and Matrix',
                    detail: notice.text,
                    buttons: ['Continue with sharing', 'Turn off sharing'],
                    defaultId: 0,
                    cancelId: 1,
                    noLink: true,
                })
                return choice.response === 0
            },
        })
    } catch {
        initializationError = 'Diagnostics are off. Secure settings could not be loaded.'
    }
}

export function diagnosticsStatus(): DiagnosticsStatus {
    return {
        configured: !!client,
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

/** The app's single queue shares the existing camera transport; no additional camera connection. */
export async function diagnosticUsbTransport(
    manufacturer: string,
    model: string
): Promise<Awaited<ReturnType<TransportFactory['createUSBTransport']>> | undefined> {
    if (!client || !/^[a-f0-9]{7,40}$/.test(__LINK_REVISION__)) return undefined
    const context: CameraContext = {
        manufacturer,
        model,
        firmware: 'unknown',
        revision: __LINK_REVISION__,
        dirty: __LINK_DIRTY__,
        transport: 'usb',
        evidence: 'hardware',
    }
    try {
        return client.observe(await new TransportFactory().createUSBTransport(), context).transport
    } catch {
        return undefined
    } // Invalid identity cannot interrupt normal camera control.
}
export function closeDiagnostics() {
    client?.close()
}
