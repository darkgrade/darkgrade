import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

test('CLI identity persists, preferences work offline, and delete disables sharing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-cli-'))
    const run = (action: string) =>
        promisify(execFile)(process.execPath, ['dist/main.js', 'telemetry', action], {
            env: { ...process.env, DARKGRADE_HOME: directory, DARKGRADE_TELEMETRY_URL: '' },
        })
    try {
        const identity = (await run('whoami')).stdout.trim()
        assert.match(identity, /^[a-f0-9-]{36}$/)
        assert.equal((await run('whoami')).stdout.trim(), identity)
        await run('opt-out')
        assert.equal(JSON.parse((await run('status')).stdout).sharing, false)
        await run('opt-in')
        assert.equal(JSON.parse((await run('status')).stdout).sharing, true)
        assert.equal(
            JSON.parse((await run('status')).stdout).effectiveSharing,
            false,
            'no endpoint means no cloud sharing'
        )
        const overridden = await promisify(execFile)(process.execPath, ['dist/main.js', 'telemetry', 'status'], {
            env: {
                ...process.env,
                DARKGRADE_HOME: directory,
                DARKGRADE_TELEMETRY_URL: 'https://telemetry.example',
                DO_NOT_TRACK: '1',
            },
        })
        assert.equal(JSON.parse(overridden.stdout).effectiveSharing, false)
        for (const args of [['login'], ['login', 'invalid'], ['login', 'camera@example.com'], ['opt-out', 'extra']])
            await assert.rejects(
                promisify(execFile)(process.execPath, ['dist/main.js', 'telemetry', ...args], {
                    env: { ...process.env, DARKGRADE_HOME: directory, DARKGRADE_TELEMETRY_URL: '' },
                })
            )
        assert.equal(JSON.parse((await run('status')).stdout).sharing, true, 'invalid commands cannot change consent')
        await run('delete')
        const state = JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))
        assert.equal(state.enabled, false)
        assert.equal(state.withdrawalPending, false)
        assert.ok(!(await run('status')).stdout.includes(state.enrollmentKey))
        await assert.rejects(run('invalid'))
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
