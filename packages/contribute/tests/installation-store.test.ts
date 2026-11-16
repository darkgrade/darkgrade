import { NOTICE_VERSION } from '@darkgrade/contribute/batch'
import { installationFileStore } from '@darkgrade/contribute/installation-store'
import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

test('installation settings are encrypted, atomic, restrictive and fail closed on corruption', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'diagnostics-settings-'))
    const path = join(directory, 'identity.bin')
    const key = randomBytes(32)
    const store = installationFileStore(path, {
        encrypt(value) {
            const nonce = randomBytes(12),
                cipher = createCipheriv('aes-256-gcm', key, nonce)
            const ciphertext = Buffer.concat([cipher.update(value), cipher.final()])
            return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
        },
        decrypt(value) {
            const decipher = createDecipheriv('aes-256-gcm', key, value.slice(0, 12))
            decipher.setAuthTag(value.slice(12, 28))
            return Buffer.concat([decipher.update(value.slice(28)), decipher.final()]).toString()
        },
    })
    try {
        assert.equal(await store.read(), null)
        const state = { enabled: false, noticeVersion: NOTICE_VERSION, withdrawalPending: true }
        await store.write(state)
        assert.deepEqual(await store.read(), state)
        assert.equal((await stat(path)).mode & 0o777, 0o600)
        assert.ok(!(await readFile(path)).includes(Buffer.from('noticeVersion')))
        await Promise.all([store.write({ ...state, enabled: true }), store.write(state)])
        assert.deepEqual(await store.read(), state)
        await writeFile(path, 'corrupt')
        await assert.rejects(store.read())
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
