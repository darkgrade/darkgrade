import { closeNodeDiagnostics } from '@darkgrade/contribute/settings'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ directory: '', notices: 0 }))
vi.mock('electron', () => ({
    app: { getPath: () => fixture.directory },
    dialog: {
        showMessageBox: async () => {
            fixture.notices++
            return { response: 1 }
        },
    },
    safeStorage: {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'gnome_libsecret',
        encryptString: (value: string) => Buffer.from(value).reverse(),
        decryptString: (value: Buffer) => Buffer.from(value).reverse().toString(),
    },
}))
let current: typeof import('@main/diagnostics')
beforeEach(async () => {
    await closeNodeDiagnostics()
    vi.resetModules()
    fixture.directory = await mkdtemp(join(tmpdir(), 'studio-diagnostics-'))
    fixture.notices = 0
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('No network expected in settings tests') }))
    vi.stubEnv('DARKGRADE_HOME', fixture.directory)
    vi.stubEnv('DARKGRADE_TELEMETRY_URL', 'https://telemetry.example')
    current = await import('@main/diagnostics')
})
afterEach(async () => {
    current.closeDiagnostics()
    await closeNodeDiagnostics()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    await rm(fixture.directory, { recursive: true, force: true })
})
test('Studio uses the default collector without endpoint configuration', async () => {
    vi.stubEnv('DARKGRADE_TELEMETRY_URL', '')
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus()).toMatchObject({ configured: true, enabled: true, sharingEnabled: true })
    expect(fixture.notices).toBe(0)
})
test('default sharing needs no notice; a saved opt-out survives reopening and credentials stay private', async () => {
    await current.initializeDiagnostics()
    expect(fixture.notices).toBe(0)
    expect(current.diagnosticsStatus()).toMatchObject({ configured: true, enabled: true, enrolled: false })
    expect(current.diagnosticsStatus()).not.toHaveProperty('installKey')
    expect(current.diagnosticsStatus()).not.toHaveProperty('enrollmentKey')
    await current.changeDiagnostics('sharing', false)
    current.closeDiagnostics()
    await closeNodeDiagnostics()
    vi.resetModules()
    current = await import('@main/diagnostics')
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus().enabled).toBe(false)
    await expect(current.changeDiagnostics('unknown')).rejects.toThrow('Invalid')
})
test('corrupt shared settings fail closed rather than resetting a preference', async () => {
    await writeFile(join(fixture.directory, 'settings.json'), 'corrupted')
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus()).toMatchObject({ configured: false, enabled: false })
    expect(current.diagnosticsStatus().error).toContain('could not be loaded')
})
test('the previous encrypted Studio opt-out migrates into shared settings without a notice', async () => {
    const identity = createHash('sha256').update('https://telemetry.example').digest('hex').slice(0, 20)
    const { installationFileStore } = await import('@darkgrade/contribute/installation-store')
    const store = installationFileStore(join(fixture.directory, `diagnostics-${identity}.bin`), {
        encrypt: value => Buffer.from(value).reverse(),
        decrypt: value => Buffer.from(value).reverse().toString(),
    })
    await store.write({ enabled: false, withdrawalPending: false, noticeVersion: 'camera-diagnostics-90d/v1' })
    await current.initializeDiagnostics()
    expect(current.diagnosticsStatus()).toMatchObject({ configured: true, enabled: false, sharingEnabled: false })
    expect(fixture.notices).toBe(0)
})
