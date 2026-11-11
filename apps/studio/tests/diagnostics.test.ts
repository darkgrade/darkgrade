import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ directory: '', choice: 1, secure: true, notices: 0 }))
vi.mock('electron', () => ({
    app: { getPath: () => fixture.directory },
    dialog: {
        showMessageBox: async () => {
            fixture.notices++
            return { response: fixture.choice }
        },
    },
    safeStorage: {
        isEncryptionAvailable: () => fixture.secure,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (value: string) => Buffer.from(value).reverse(),
        decryptString: (value: Buffer) => Buffer.from(value).reverse().toString(),
    },
}))
vi.mock('@darkgrade/link', () => ({ TransportFactory: class {} }))
let current: typeof import('@main/diagnostics')
beforeEach(async () => {
    vi.resetModules()
    fixture.directory = await mkdtemp(join(tmpdir(), 'studio-diagnostics-'))
    fixture.choice = 1
    fixture.secure = true
    fixture.notices = 0
    vi.stubEnv('DARKGRADE_TELEMETRY_URL', 'https://telemetry.example')
    current = await import('@main/diagnostics')
})
afterEach(async () => {
    current.closeDiagnostics()
    vi.unstubAllEnvs()
    await rm(fixture.directory, { recursive: true, force: true })
})
test('Studio stays off without a configured endpoint and reports the setting honestly', async () => {
    vi.stubEnv('DARKGRADE_TELEMETRY_URL', '')
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus()).toMatchObject({ configured: false, enabled: false })
    expect(fixture.notices).toBe(0)
})
test('first-run opt-out persists, and renderer status never exposes the install credential', async () => {
    await current.initializeDiagnostics()
    expect(fixture.notices).toBe(1)
    expect(current.diagnosticsStatus()).toMatchObject({ configured: true, enabled: false, enrolled: false })
    expect(current.diagnosticsStatus()).not.toHaveProperty('installKey')
    current.closeDiagnostics()
    vi.resetModules()
    current = await import('@main/diagnostics')
    await current.initializeDiagnostics()
    expect(fixture.notices).toBe(1)
    expect(current.diagnosticsStatus().enabled).toBe(false)
    await expect(current.changeDiagnostics('unknown')).rejects.toThrow('Invalid')
})
test('undecryptable saved preferences fail closed instead of replacing an opt-out', async () => {
    const identity = createHash('sha256').update('https://telemetry.example').digest('hex').slice(0, 20)
    await writeFile(join(fixture.directory, `diagnostics-${identity}.bin`), 'corrupted')
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus()).toMatchObject({ configured: false, enabled: false })
    expect(current.diagnosticsStatus().error).toContain('could not be loaded')
    expect(fixture.notices).toBe(0)
})
test('Studio refuses an unavailable OS credential store', async () => {
    fixture.secure = false
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus()).toMatchObject({ configured: false, enabled: false })
    expect(fixture.notices).toBe(0)
})
