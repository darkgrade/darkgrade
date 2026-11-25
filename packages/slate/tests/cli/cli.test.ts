import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const runner =
    'import { runDarkgradeCli } from "@darkgrade/slate/cli"; process.exitCode = await runDarkgradeCli(process.argv.slice(1));'
const command = (...args: string[]) => ['--input-type=module', '--eval', runner, '--', ...args]

test('importing the command runner is inert and preference commands never load native camera drivers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-slate-command-'))
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
        const { runDarkgradeCli } = await import('@darkgrade/slate/cli');
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

test('Slate command identity persists, preferences work offline, and delete disables sharing', async () => {
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
        for (const args of [
            ['login'],
            ['login', 'invalid'],
            ['opt-out', 'extra'],
            ['status', '--invalid'],
            ['status', '--email', 'extra'],
        ])
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

test('help, version, completions and the manual page answer in every standard form', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'darkgrade-cli-surface-'))
    const env = { ...process.env, DARKGRADE_HOME: directory, DARKGRADE_TELEMETRY_URL: '', NO_COLOR: '', FORCE_COLOR: '' }
    const run = (...args: string[]) => promisify(execFile)(process.execPath, command(...args), { env })
    const fails = async (args: string[], message: RegExp) =>
        assert.rejects(run(...args), (error: unknown) => {
            const result = error as { code: number; stdout: string; stderr: string }
            return result.code === 1 && result.stdout === '' && message.test(result.stderr)
        })
    try {
        const rootHelp = (await run()).stdout
        assert.match(rootHelp, /Usage\n {2}darkgrade <command> \[options\]/)
        assert.match(rootHelp, /telemetry benchmark +Run every check/)
        assert.ok(!rootHelp.includes('\u001b['), 'piped help carries no escape codes')
        for (const form of [['--help'], ['-h'], ['help']]) assert.equal((await run(...form)).stdout, rootHelp)

        const benchmarkHelp = (await run('telemetry', 'benchmark', '--help')).stdout
        assert.match(benchmarkHelp, /--camera <VID:PID>/)
        assert.ok(!benchmarkHelp.includes('--capture '), 'flags kept for older scripts stay out of help')
        assert.equal((await run('help', 'telemetry', 'benchmark')).stdout, benchmarkHelp)
        assert.equal((await run('telemetry', '-h', 'benchmark')).stdout, benchmarkHelp)
        assert.match((await run('telemetry')).stdout, /darkgrade telemetry <command>/)

        for (const form of [['--version'], ['-V'], ['version'], ['telemetry', 'status', '--version']])
            assert.equal((await run(...form)).stdout, 'darkgrade development\n')
        assert.equal(JSON.parse((await run('version', '--json')).stdout).node, process.versions.node)

        await fails(['telemtry', 'status'], /Unknown command "telemtry"\. Did you mean "telemetry"\?/)
        await fails(['telemetry', 'stats'], /Did you mean "telemetry status"\?/)
        await fails(['telemetry', 'status', '--emial'], /Unknown option "--emial".*Did you mean "--email"\?/)
        await fails(['telemetry', 'login'], /An email address is needed/)
        await fails(['completions'], /Name a shell: bash, zsh, fish/)
        await fails(['completions', 'powershell'], /not one of bash, zsh, fish/)
        await fails(['telemetry', 'benchmark', '--camera'], /--camera needs a value/)

        assert.match((await run('completions', 'bash')).stdout, /complete -F _darkgrade darkgrade/)
        assert.match((await run('completions', 'zsh')).stdout, /^#compdef darkgrade/)
        assert.match((await run('completions', 'fish')).stdout, /complete -c darkgrade .*-l camera -r/)
        const manual = (await run('man')).stdout
        assert.match(manual, /^\.TH DARKGRADE 1 /)
        assert.match(manual, /\.SS darkgrade telemetry benchmark/)

        // A pipe still gets the JSON that scripts already parse; --json says so explicitly.
        assert.equal(typeof JSON.parse((await run('telemetry', 'status', '--json')).stdout).sharing, 'boolean')
        // Without a terminal nothing can be asked, so delete runs as it always has.
        assert.match((await run('telemetry', 'delete')).stdout, /Sharing is off/)
    } finally {
        await rm(directory, { recursive: true, force: true })
    }
})
