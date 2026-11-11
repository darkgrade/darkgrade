import { validateInstallationState, type InstallationState, type InstallationStore } from '#contribute/application'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

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
            const operation = writes
                .catch(() => {})
                .then(async () => {
                    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
                    const temporary = `${path}.${randomUUID()}.tmp`
                    try {
                        const file = await open(temporary, 'wx', 0o600)
                        try {
                            await file.writeFile(bytes)
                            await file.sync()
                        } finally {
                            await file.close()
                        }
                        await rename(temporary, path)
                        const directory = await open(dirname(path), 'r')
                        try {
                            await directory.sync()
                        } finally {
                            await directory.close()
                        }
                    } finally {
                        await unlink(temporary).catch(() => {})
                    }
                })
            writes = operation
            return operation
        },
    }
}
