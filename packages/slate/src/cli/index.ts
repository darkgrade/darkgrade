import { kebabCase } from '@camera/operation-table/index'
import { OperationInputError } from '@runtime/operations'
import {
    cameraCommandOperations,
    closestMatch,
    commandLine,
    completionShells,
    globalFlags,
    programName,
    resolveCommand,
    visibleFlags,
    type CommandDefinition,
    type CompletionShell,
} from '@cli/commands'
import { renderHelp, usageLine } from '@cli/help'
import { createTerminal, type GlobalFlags, type Terminal, type TerminalStreams } from '@cli/terminal'
import { closeNodeDiagnostics, nodeDiagnostics, settingsDirectory, sharedSettings } from '@contribute/settings'
import { randomUUID } from 'node:crypto'

/** What the embedding executable knows and Slate does not. */
export interface DarkgradeCliHost {
    /** The executable's own release, printed by `--version`. */
    version?: string
    /** Replaces the process streams and environment, for hosts that are not a terminal. */
    streams?: TerminalStreams
}

/** The arguments were not understood. Reported with the command's usage line and a pointer to its help. */
class UsageError extends Error {
    constructor(
        message: string,
        readonly path: readonly CommandDefinition[]
    ) {
        super(message)
    }
}

/** Global flags are taken from anywhere before `--`; everything else is left in order for the command. */
function separateGlobalFlags(argumentsList: readonly string[]): { flags: GlobalFlags; words: string[] } {
    const flags: GlobalFlags = {
        help: false,
        version: false,
        noColor: false,
        noInput: false,
        noProgress: false,
        quiet: false,
    }
    const keys: Record<string, keyof GlobalFlags> = {
        help: 'help',
        version: 'version',
        quiet: 'quiet',
        'no-color': 'noColor',
        'no-input': 'noInput',
        'no-progress': 'noProgress',
    }
    const words: string[] = []
    const terminator = argumentsList.indexOf('--')
    const before = terminator < 0 ? argumentsList : argumentsList.slice(0, terminator)
    for (const word of before) {
        const flag = globalFlags.find(candidate => word === `--${candidate.name}` || word === `-${candidate.short}`)
        if (flag) flags[keys[flag.name]] = true
        else words.push(word)
    }
    return { flags, words: terminator < 0 ? words : [...words, ...argumentsList.slice(terminator + 1)] }
}

/** Checks a leaf command's words against its definition: known flags, their values, and one optional argument. */
function parseCommandArguments(
    path: readonly CommandDefinition[],
    words: readonly string[]
): { flags: Map<string, string | true>; argument?: string; positionals: string[] } {
    const command = path[path.length - 1]
    const flags = new Map<string, string | true>()
    const positionals: string[] = []
    for (let index = 0; index < words.length; index++) {
        const word = words[index]
        if (!word.startsWith('-') || word === '-') {
            positionals.push(word)
            continue
        }
        const flag = (command.flags ?? []).find(
            candidate => word === `--${candidate.name}` || word === `-${candidate.short}`
        )
        if (!flag) {
            const suggestion = closestMatch(
                word,
                visibleFlags(command).map(candidate => `--${candidate.name}`)
            )
            throw new UsageError(
                `Unknown option "${word}" for ${commandLine(path)}.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`,
                path
            )
        }
        if (!flag.value) flags.set(flag.name, true)
        else if (index + 1 < words.length) flags.set(flag.name, words[++index])
        else throw new UsageError(`--${flag.name} needs a value: --${flag.name} <${flag.value}>.`, path)
    }
    const expected = command.arguments ?? []
    if (positionals.length > expected.length) throw new UsageError(`Unexpected "${positionals[expected.length]}".`, path)
    expected.forEach((argument, index) => {
        const value = positionals[index]
        const choices = argument.choices
        if (choices && value !== undefined && !choices.includes(value)) {
            const suggestion = closestMatch(value, choices)
            throw new UsageError(
                `"${value}" is not one of ${choices.join(', ')}.${suggestion ? ` Did you mean "${suggestion}"?` : ''}`,
                path
            )
        }
    })
    return { flags, argument: positionals[0], positionals }
}

function unknownCommand(path: readonly CommandDefinition[], word: string): UsageError {
    const parent = path[path.length - 1]
    const suggestion = closestMatch(
        word,
        (parent.commands ?? []).map(command => command.name)
    )
    return new UsageError(
        `Unknown command "${word}".${suggestion ? ` Did you mean "${[...path.slice(1).map(command => command.name), suggestion].join(' ')}"?` : ''}`,
        path
    )
}

const validEmail = (value: string) => value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value)

async function runTelemetryCommand(
    path: readonly CommandDefinition[],
    words: readonly string[],
    terminal: Terminal
): Promise<number> {
    const action = path[path.length - 1].name
    if (action === 'benchmark') {
        parseCommandArguments(path, words)
        const { runBenchmarkCommand } = await import('@cli/benchmark')
        return runBenchmarkCommand(words, undefined, terminal)
    }
    const { flags, argument } = parseCommandArguments(path, words)
    let email = argument
    if (action === 'login') {
        if (!email && terminal.interactive) email = await terminal.ask('Email address:')
        if (!email) throw new UsageError('An email address is needed: darkgrade telemetry login <email>.', path)
        if (!validEmail(email)) throw new UsageError(`"${email}" is not an email address.`, path)
    }
    const store = sharedSettings()
    const saved = await store.read()
    if (!saved) throw new Error('Telemetry settings unavailable')
    const installationId = saved.installationId ?? saved.installKey?.slice(4, 40)
    const progress = terminal.progress()
    const during = async <Result>(text: string, work: () => Promise<Result>) => {
        if (terminal.animated) progress.update(text)
        try {
            return await work()
        } finally {
            progress.stop()
        }
    }
    if (action === 'whoami') terminal.print(String(installationId))
    else if (action === 'status') {
        const status = {
            installationId,
            sharing: saved.enabled,
            effectiveSharing:
                saved.enabled &&
                !saved.withdrawalPending &&
                process.env.DARKGRADE_CONTRIBUTIONS !== '0' &&
                process.env.DO_NOT_TRACK !== '1',
            configured: true,
            deletionPending: saved.withdrawalPending,
            settings: settingsDirectory(),
            ...(flags.has('email') && {
                contact: await during('Reading the linked email…', async () =>
                    (await nodeDiagnostics()).contactStatus()
                ),
            }),
        }
        // A person reads the table; a pipe or --json gets the same JSON as before.
        if (flags.has('json') || !terminal.readable) terminal.print(JSON.stringify(status))
        else terminal.print(describeStatus(status, terminal))
    } else if (action === 'opt-out' || action === 'opt-in') {
        if (action === 'opt-in' && saved.withdrawalPending)
            throw new Error('Finish pending deletion before enabling sharing')
        await store.write({
            ...saved,
            enabled: action === 'opt-in',
            ...(action === 'opt-in' && !saved.installKey && !saved.enrollmentKey
                ? { installationId: randomUUID() }
                : {}),
        })
        terminal.print(action === 'opt-out' ? 'Sharing disabled.' : 'Sharing enabled.')
    } else if (action === 'login') {
        await during('Requesting a confirmation email…', async () => (await nodeDiagnostics()).requestContact(email!))
        terminal.print(
            'Confirmation email requested. The submitted address is unverified until you open its link (expires in 2 hours). A verified replacement reassigns this installation’s retained history.'
        )
    } else if (action === 'logout') {
        if (saved.installKey)
            await during('Removing the linked email…', async () => (await nodeDiagnostics()).removeContact())
        terminal.print('Email association removed. Your sharing preference is unchanged.')
    } else if (action === 'delete') {
        if (
            terminal.interactive &&
            !flags.has('yes') &&
            !(await terminal.confirm('Turn sharing off and delete the diagnostics this installation has shared?'))
        ) {
            terminal.report('Cancelled. Nothing was changed.')
            return 1
        }
        // Disable locally before touching network, including when the service is not configured.
        await store.write({
            ...saved,
            enabled: false,
            withdrawalPending: !!saved.installKey || !!saved.registrationPending,
        })
        if (saved.installKey || saved.registrationPending) {
            const pending = await during('Deleting cloud data…', async () => {
                const client = await nodeDiagnostics()
                await client.retryWithdrawal()
                return client.status().withdrawalPending
            })
            terminal.print(pending ? 'Sharing is off. Deletion is pending.' : 'Sharing is off. Cloud data deleted.')
        } else terminal.print('Sharing is off. No cloud enrollment exists.')
    }
    return 0
}

function describeStatus(
    status: {
        installationId?: string
        sharing: boolean
        effectiveSharing: boolean
        deletionPending: boolean
        settings: string
        contact?: { email: string; verified: boolean; pendingEmail?: string } | null
    },
    terminal: Terminal
): string {
    const { out } = terminal
    const sharing = !status.sharing
        ? out.yellow('off')
        : status.effectiveSharing
          ? out.green('on')
          : out.yellow(
                status.deletionPending
                    ? 'on, paused until deletion finishes'
                    : 'on, but stopped by DO_NOT_TRACK or DARKGRADE_CONTRIBUTIONS'
            )
    const contact = status.contact
    const rows = [
        ['Sharing', sharing],
        ['Diagnostic ID', String(status.installationId)],
        ...(status.deletionPending
            ? [['Deletion', out.yellow('pending; run darkgrade telemetry delete to retry')]]
            : []),
        ...(contact === undefined
            ? []
            : [
                  [
                      'Email',
                      contact
                          ? `${contact.email} ${contact.verified ? out.green('verified') : out.yellow('not verified yet')}` +
                            (contact.pendingEmail ? `, ${contact.pendingEmail} awaiting confirmation` : '')
                          : 'none linked',
                  ],
              ]),
        ['Settings', status.settings],
    ]
    const next = status.sharing ? 'darkgrade telemetry opt-out' : 'darkgrade telemetry opt-in'
    return [
        ...rows.map(([label, value]) => `${out.dim(label.padEnd(15))}${value}`),
        '',
        out.dim(`${status.sharing ? 'Stop sharing' : 'Share diagnostics'} with: ${next}`),
    ].join('\n')
}

async function openManual(version: string | undefined, terminal: Terminal): Promise<number> {
    const { manualPage } = await import('@cli/manual')
    const page = manualPage(version)
    if (!terminal.readable) {
        terminal.print(page.trimEnd())
        return 0
    }
    const { spawnSync } = await import('node:child_process')
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const directory = mkdtempSync(path.join(tmpdir(), 'darkgrade-manual-'))
    try {
        const file = path.join(directory, `${programName}.1`)
        writeFileSync(file, page)
        const viewer = spawnSync('man', [file], { stdio: 'inherit' })
        // Windows and minimal containers have no `man`; the same content is in the help screens.
        if (viewer.error || viewer.status !== 0)
            terminal.print(renderHelp(resolveCommand([]).path, terminal.out, { version }))
        return 0
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
}

/** `darkgrade camera <operation>`: the camera operations, loaded only when one runs. */
async function runCameraCommand(
    path: readonly CommandDefinition[],
    words: readonly string[],
    terminal: Terminal
): Promise<number> {
    const command = path[path.length - 1]
    const operation = cameraCommandOperations.get(command.name)
    if (!operation) throw unknownCommand(path.slice(0, -1), command.name)
    const { flags, positionals } = parseCommandArguments(path, words)
    const recording = await import('@cli/recording')
    const text = (name: string) => {
        const value = flags.get(name)
        return typeof value === 'string' ? value : undefined
    }
    const parse = <Value>(name: string, parser: (value: string) => Value): Value | undefined => {
        const value = text(name) ?? (name === 'camera' ? process.env.DARKGRADE_CAMERA || undefined : undefined)
        if (value === undefined) return undefined
        try {
            return parser(value)
        } catch (error) {
            throw new UsageError(`--${name}: ${error instanceof Error ? error.message : String(error)}`, path)
        }
    }
    const camera = parse('camera', recording.parseCameraId)
    if (operation.name === 'startRecording')
        return recording.runStartRecordingCommand({
            camera,
            durationMilliseconds: parse('duration', recording.parseRecordingDuration),
            json: flags.has('json'),
        })
    // Required inputs are positional, in the library's order; the rest are flags.
    const input: Record<string, string | boolean> = {}
    const required = operation.parameters.filter(parameter => parameter.required)
    required.forEach((parameter, index) => {
        const value = positionals[index]
        if (value === undefined)
            throw new UsageError(`${command.name} needs <${kebabCase(parameter.name)}>: ${parameter.description}.`, path)
        input[parameter.name] = value
    })
    for (const parameter of operation.parameters.filter(candidate => !candidate.required)) {
        const flag = kebabCase(parameter.name)
        if (parameter.type === 'switch') {
            if (parameter.default && flags.has(`no-${flag}`)) input[parameter.name] = false
            else if (!parameter.default && flags.has(flag)) input[parameter.name] = true
        } else if (text(flag) !== undefined) input[parameter.name] = text(flag)!
    }
    const { runCameraOperationCommand } = await import('@cli/camera-operation')
    try {
        return await runCameraOperationCommand({ operation, input, camera, outputPath: text('output'), json: flags.has('json') }, terminal)
    } catch (error) {
        if (error instanceof OperationInputError) throw new UsageError(error.message, path)
        throw error
    }
}

async function runCommand(
    words: readonly string[],
    flags: GlobalFlags,
    host: DarkgradeCliHost,
    terminal: Terminal
): Promise<number> {
    const help = (path: readonly CommandDefinition[]) => {
        terminal.print(renderHelp(path, terminal.out, { version: host.version, columns: terminal.columns }))
        return 0
    }
    const versionLine = `${programName} ${host.version ?? 'development'}`
    if (flags.version) {
        terminal.print(versionLine)
        return 0
    }
    const { path, remaining } = resolveCommand(words)
    const command = path[path.length - 1]
    if (command.commands) {
        if (remaining.length && !remaining[0].startsWith('-')) throw unknownCommand(path, remaining[0])
        if (remaining.length) parseCommandArguments(path, remaining)
        return help(path)
    }
    if (command.name === 'help') {
        const topic = resolveCommand(remaining)
        if (topic.remaining.length) throw unknownCommand(topic.path, topic.remaining[0])
        return help(topic.path)
    }
    if (flags.help) return help(path)
    if (path[1].name === 'telemetry') return runTelemetryCommand(path, remaining, terminal)
    if (path[1].name === 'camera') return runCameraCommand(path, remaining, terminal)
    const { flags: commandFlags, argument } = parseCommandArguments(path, remaining)
    const json = commandFlags.has('json')
    if (command.name === 'version') {
        terminal.print(
            json
                ? JSON.stringify({
                      version: host.version ?? null,
                      node: process.versions.node,
                      platform: process.platform,
                      architecture: process.arch,
                  })
                : versionLine
        )
        return 0
    }
    if (command.name === 'completions') {
        if (!argument) throw new UsageError(`Name a shell: ${completionShells.join(', ')}.`, path)
        const { completionScript } = await import('@cli/completions')
        terminal.print(completionScript(argument as CompletionShell).trimEnd())
        return 0
    }
    if (command.name === 'man') return openManual(host.version, terminal)
    if (command.name === 'cameras') return (await import('@cli/cameras')).runCamerasCommand({ json }, terminal)
    if (command.name === 'doctor')
        return (await import('@cli/doctor')).runDoctorCommand({ json, version: host.version }, terminal)
    throw unknownCommand(path.slice(0, -1), command.name)
}

/** Terminal command behavior shared by the thin darkgrade executable and other Node hosts. */
export async function runDarkgradeCli(argumentsList: readonly string[], host: DarkgradeCliHost = {}): Promise<number> {
    const { flags, words } = separateGlobalFlags(argumentsList)
    const terminal = createTerminal(flags, host.streams)
    try {
        return await runCommand(words, flags, host, terminal)
    } catch (error) {
        const { err } = terminal
        const message = error instanceof Error ? error.message : 'The command failed'
        terminal.report(`${err.red('error:')} ${message}`)
        if (error instanceof UsageError) {
            const path = error.path
            terminal.report(`${err.dim('Usage:')} ${usageLine(path)}`)
            terminal.report(err.dim(`Run "${[commandLine(path), '--help'].join(' ')}" for details.`))
        } else if (process.env.DARKGRADE_DEBUG && error instanceof Error && error.stack)
            terminal.report(err.dim(error.stack))
        return 1
    } finally {
        await closeNodeDiagnostics().catch(() => {})
    }
}
