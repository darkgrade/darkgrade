import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const runner =
    'import { runDarkgradeCli } from "@darkgrade/link/cli"; process.exitCode = await runDarkgradeCli(process.argv.slice(1));'
const command = (...args: string[]) => ['--input-type=module', '--eval', runner, '--', ...args]

test('importing the command runner is inert and preference commands never load native camera drivers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-link-command-'))
    const script = `
        import assert from 'node:assert/strict';
        import { existsSync } from 'node:fs';
        import { join } from 'node:path';
        import { createRequire } from 'node:module';
        const require = createRequire(import.meta.url);
        const Module = require('node:module');
        const load = Module._load;
        Module._load = function(name, ...args) {
            if (['usb', 'usb-rs'].includes(name)) throw Error('Preference commands loaded a native camera driver');
            return load.call(this, name, ...args);
        };
        const { runDarkgradeCli } = await import('@darkgrade/link/cli');
        assert.equal(existsSync(join(process.env.DARKGRADE_HOME, 'settings.json')), false);
        assert.equal(await runDarkgradeCli(['telemetry', 'status']), 0);
    `
    try {
        const result = await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script], {
            env: { ...process.env, DARKGRADE_HOME: directory, DARKGRADE_TELEMETRY_URL: '' },
        })
        assert.equal(JSON.parse(result.stdout).configured, true)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})

test('Link command identity persists, preferences work offline, and delete disables sharing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-cli-'))
    const run = (action: string) =>
        promisify(execFile)(process.execPath, command('telemetry', action), {
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
            true,
            'the built-in endpoint enables sharing without configuration'
        )
        const overridden = await promisify(execFile)(process.execPath, command('telemetry', 'status'), {
            env: {
                ...process.env,
                DARKGRADE_HOME: directory,
                DARKGRADE_TELEMETRY_URL: 'https://telemetry.example',
                DO_NOT_TRACK: '1',
            },
        })
        assert.equal(JSON.parse(overridden.stdout).effectiveSharing, false)
        for (const args of [['login'], ['login', 'invalid'], ['opt-out', 'extra']])
            await assert.rejects(
                promisify(execFile)(process.execPath, command('telemetry', ...args), {
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
