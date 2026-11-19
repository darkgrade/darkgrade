import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

test('the executable delegates to Link and preserves terminal output and exit codes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-wrapper-'))
    const env = { ...process.env, DARKGRADE_HOME: directory, DARKGRADE_TELEMETRY_URL: '' }
    try {
        const identity = (
            await promisify(execFile)(process.execPath, ['dist/main.js', 'telemetry', 'whoami'], { env })
        ).stdout.trim()
        assert.match(identity, /^[a-f0-9-]{36}$/)
        const status = JSON.parse(
            (await promisify(execFile)(process.execPath, ['dist/main.js', 'telemetry', 'status'], { env })).stdout
        )
        assert.equal(status.installationId, identity)
        const hook = `import Module from 'node:module';
            const load = Module._load;
            Module._load = function(name, ...args) {
                if (['usb', 'usb-rs'].includes(name)) throw Error('Preference command loaded USB');
                return load.call(this, name, ...args);
            };`
        const withoutCameraDrivers = await promisify(execFile)(
            process.execPath,
            ['--import', 'data:text/javascript,' + encodeURIComponent(hook), 'dist/main.js', 'telemetry', 'status'],
            { env }
        )
        assert.equal(JSON.parse(withoutCameraDrivers.stdout).installationId, identity)
        await assert.rejects(
            promisify(execFile)(process.execPath, ['dist/main.js', 'invalid'], { env }),
            (error: unknown) => {
                const result = error as { code: number; stderr: string }
                return result.code === 1 && result.stderr.includes('darkgrade telemetry')
            }
        )
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
