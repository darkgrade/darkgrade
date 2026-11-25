import { validateInstallationState, type InstallationState, type InstallationStore } from '@contribute/application'
import { replaceFileDurably } from '@contribute/durable-file'
import { readFile } from 'node:fs/promises'

/** OS-backed encryption (e.g. Electron safeStorage). Never substitute an embedded application key. */
export interface CredentialProtection {
    encrypt(value: string): Uint8Array
    decrypt(value: Uint8Array): string
}

/** One owner per application. Corrupt/undecryptable files fail closed; updates replace atomically. */
export function installationFileStore(path: string, protection: CredentialProtection): InstallationStore {
    let writes = Promise.resolve()
    return {
        async read() {
            await writes
            let bytes: Buffer
            try {
                bytes = await readFile(path)
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
                throw error
            }
            const state: unknown = JSON.parse(protection.decrypt(bytes))
            validateInstallationState(state)
            return state
        },
        write(state: InstallationState) {
            validateInstallationState(state)
            const bytes = protection.encrypt(JSON.stringify(state))
            const operation = writes.catch(() => {}).then(() => replaceFileDurably(path, bytes))
            writes = operation
            return operation
        },
    }
}
