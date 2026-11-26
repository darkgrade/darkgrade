import { CONTACT_CONFIRMATION_HOURS } from '@contribute/schema'
import { fileRoles, kebabCase, surfaceOperations, type SurfaceOperation } from '@runtime/operations'

/** The one description of the command tree. Help, the manual page, shell completions,
 * argument checks and typo suggestions are all drawn from it. */
export interface FlagDefinition {
    name: string
    short?: string
    /** Placeholder for the value the flag takes; a flag without one is a switch. */
    value?: string
    summary: string
    /** Accepted for older scripts; left out of help and completions. */
    hidden?: boolean
}

export interface ArgumentDefinition {
    name: string
    required: boolean
    choices?: readonly string[]
}

export interface CommandDefinition {
    name: string
    summary: string
    description?: string
    /** Heading the command is listed under in its parent's help. */
    section?: string
    /** Positional arguments, in order. */
    arguments?: readonly ArgumentDefinition[]
    flags?: readonly FlagDefinition[]
    examples?: readonly string[]
    commands?: readonly CommandDefinition[]
}

export const programName = 'darkgrade'
export const documentationUrl = 'https://darkgrade.com/docs'
export const issuesUrl = 'https://github.com/darkgrade/darkgrade/issues'
export const completionShells = ['bash', 'zsh', 'fish'] as const
export type CompletionShell = (typeof completionShells)[number]

export const globalFlags: readonly FlagDefinition[] = [
    { name: 'help', short: 'h', summary: 'Show help for the command' },
    { name: 'version', short: 'V', summary: 'Print the version' },
    { name: 'quiet', short: 'q', summary: 'Print results only, no progress' },
    { name: 'no-color', summary: 'Plain text; NO_COLOR does the same' },
    { name: 'no-input', summary: 'Never ask a question; fail and name the missing flag instead' },
    { name: 'no-progress', summary: 'No spinner; one plain line for each step' },
]

const json: FlagDefinition = { name: 'json', summary: 'Print the result as one JSON document' }
const camera: FlagDefinition = { name: 'camera', value: 'VID:PID', summary: 'Use this USB device; DARKGRADE_CAMERA does the same' }

const telemetry: CommandDefinition = {
    name: 'telemetry',
    summary: 'Diagnostics sharing, your identity and the camera benchmark',
    description:
        'Darkgrade can share camera diagnostics so support for your body improves. ' +
        'These commands show and change that preference, link an email to your contributions, ' +
        'delete what was shared, and run the full benchmark on an attached camera.',
    section: 'Camera',
    examples: ['darkgrade telemetry status', 'darkgrade telemetry benchmark', 'darkgrade telemetry opt-out'],
    commands: [
        {
            name: 'benchmark',
            summary: 'Run every check on the attached camera',
            description:
                'Finds the attached camera and reads its identity, storage and every readable property, ' +
                'then takes one photo and one live-view frame. Capture can write a file on the camera; ' +
                'nothing is formatted, deleted or reset. Prints a short summary and saves a local profile.',
            section: 'Camera',
            flags: [
                camera,
                { name: 'no-capture', summary: 'Skip the photo' },
                { name: 'no-live', summary: 'Skip the live-view frame' },
                json,
                { name: 'capture', summary: 'Take the photo (the default)', hidden: true },
                { name: 'live', summary: 'Read a live-view frame (the default)', hidden: true },
            ],
            examples: [
                'darkgrade telemetry benchmark',
                'darkgrade telemetry benchmark --no-capture --no-live',
                'darkgrade telemetry benchmark --camera 054c:0e78 --json',
            ],
        },
        {
            name: 'status',
            summary: 'Show the sharing preference',
            description:
                'Reads the saved preference without contacting the service. Prints JSON when piped or with --json.',
            section: 'Sharing',
            flags: [{ name: 'email', summary: 'Also read the linked email from the service (a network request)' }, json],
            examples: ['darkgrade telemetry status', 'darkgrade telemetry status --email --json'],
        },
        {
            name: 'opt-in',
            summary: 'Share diagnostics',
            description: 'Turns sharing on. After a deletion this starts a new cloud identity.',
            section: 'Sharing',
        },
        {
            name: 'opt-out',
            summary: 'Stop sharing diagnostics',
            description: 'Stops future uploads. Local diagnostics are still written.',
            section: 'Sharing',
        },
        {
            name: 'delete',
            summary: 'Turn sharing off and delete what was shared',
            description:
                'Turns sharing off first, then deletes the cloud data. A deletion that could not finish stays pending and is retried. ' +
                'On a terminal it asks first.',
            section: 'Sharing',
            flags: [{ name: 'yes', short: 'y', summary: 'Do not ask for confirmation' }],
            examples: ['darkgrade telemetry delete --yes'],
        },
        {
            name: 'whoami',
            summary: 'Print your diagnostic ID',
            description: 'Prints the persistent random diagnostic ID, never its secret.',
            section: 'Identity',
        },
        {
            name: 'login',
            summary: 'Link an email to your contributions',
            description:
                `Requests a confirmation link. Open it within ${CONTACT_CONFIRMATION_HOURS} hours; it works once. ` +
                'On a terminal the address is asked for when left out.',
            section: 'Identity',
            arguments: [{ name: 'email', required: true }],
            examples: ['darkgrade telemetry login you@example.com'],
        },
        {
            name: 'logout',
            summary: 'Remove the linked email',
            description: 'Removes the email association. The sharing preference is unchanged.',
            section: 'Identity',
        },
    ],
}

const output: FlagDefinition = { name: 'output', value: 'path', summary: 'Write the file it returns here (default: its own name in this folder)' }

const duration: FlagDefinition = { name: 'duration', value: 'duration', summary: 'Stop after this long, for example 10s; otherwise stops on Ctrl-C' }

/** Operations held in the foreground until Ctrl-C or --duration, then stopped by their counterpart. */
export const heldOperations: Readonly<Record<string, string>> = { startRecording: 'stopRecording', startZoom: 'stopZoom' }

/** What each `darkgrade camera` command adds to its generated description: longer help and examples. */
const commandHelp: Partial<Record<string, Pick<CommandDefinition, 'description' | 'examples'>>> = {
    startZoom: {
        description:
            'Zooms like holding the zoom rocker and stays in the foreground until Ctrl-C or --duration, then stops ' +
            'the zoom. The camera stops by itself after 10 seconds.',
        examples: ['darkgrade camera start-zoom in --speed slow --duration 2s'],
    },
    startRecording: {
        description:
            'Gets the camera ready (video mode, card, audio), starts recording and stays in the foreground ' +
            'holding the session. Stops on Ctrl-C or after --duration, waits for the finished clip on the card, ' +
            'puts the camera back and prints the clip. Nothing on the card is deleted or overwritten.',
        examples: ['darkgrade camera start-recording', 'darkgrade camera start-recording --duration 10s --json'],
    },
    getCapabilities: { examples: ['darkgrade camera get-capabilities --json'] },
    setShutterSpeed: { examples: ['darkgrade camera set-shutter-speed 1/250'] },
    setControl: { examples: ['darkgrade camera set-control iso "ISO 800"'] },
    setFocusPoint: { examples: ['darkgrade camera set-focus-point 0.5 0.4'] },
    nudgeFocus: { examples: ['darkgrade camera nudge-focus near small'] },
    zoomTo: { examples: ['darkgrade camera zoom-to 35'] },
    takePhoto: { examples: ['darkgrade camera take-photo', 'darkgrade camera take-photo --destination computer --output photo.jpg'] },
    downloadMedia: { examples: ['darkgrade camera list-media --json', 'darkgrade camera download-media <id> --output clip.mp4'] },
}

/** One public operation's `darkgrade camera <kebab>` command, named, described and given its inputs from Camera. */
function cameraOperationCommand(operation: SurfaceOperation, line: string): CommandDefinition {
    const required = operation.parameters.filter(parameter => parameter.required)
    const optional = operation.parameters.filter(parameter => !parameter.required)
    const parameterFlags: FlagDefinition[] = optional.flatMap(parameter => {
        const name = kebabCase(parameter.name)
        if (parameter.type === 'switch')
            return [{ name, summary: parameter.description }, { name: `no-${name}`, summary: `the opposite of --${name}` }]
        const value = parameter.choices?.join('|') ?? (parameter.type === 'time' ? 'ISO 8601' : parameter.type)
        return [{ name, value, summary: parameter.description }]
    })
    return {
        name: line.slice('darkgrade camera '.length),
        summary: operation.summary,
        section: 'Camera',
        ...commandHelp[operation.name],
        ...(required.length && {
            arguments: required.map(parameter => ({ name: kebabCase(parameter.name), required: true, choices: parameter.choices })),
        }),
        flags: [
            ...parameterFlags,
            ...(operation.name in heldOperations ? [duration] : []),
            ...(operation.name in fileRoles ? [output] : []),
            camera,
            json,
        ],
    }
}

/** The library operation behind each `darkgrade camera` command, from the operation table. */
export const cameraCommandOperations: ReadonlyMap<string, SurfaceOperation> = new Map(
    surfaceOperations().flatMap(operation =>
        operation.cliCommand?.startsWith('darkgrade camera ')
            ? [[operation.cliCommand.slice('darkgrade camera '.length), operation] as const]
            : []
    )
)

const cameraCommands: CommandDefinition = {
    name: 'camera',
    summary: 'Operate the attached camera',
    description:
        'Each command opens the attached camera, does one thing through the same operations as the library ' +
        'and the MCP tools, and closes it again. Commands are sent once: an unconfirmed result is reported, never resent.',
    section: 'Camera',
    examples: [
        'darkgrade camera get-capabilities',
        'darkgrade camera set-iso "ISO 800"',
        'darkgrade camera take-photo',
        'darkgrade camera start-recording --duration 10s',
        'darkgrade camera watch',
    ],
    commands: [
        ...[...cameraCommandOperations].map(([line, operation]) => cameraOperationCommand(operation, `darkgrade camera ${line}`)),
        {
            name: 'watch',
            summary: 'Prints a line each time a setting changes on the camera or a new photo or clip lands',
            description:
                "Opens the camera and streams its events (the library's on('settingsChanged') and on('mediaAdded')) " +
                'until Ctrl-C or --duration. Reads only.',
            section: 'Camera',
            flags: [duration, camera, json],
            examples: ['darkgrade camera watch', 'darkgrade camera watch --duration 30s --json'],
        },
    ],
}

export const rootCommand: CommandDefinition = {
    name: programName,
    summary: 'Camera diagnostics and telemetry preferences',
    description:
        'Check that a camera is connected the way Darkgrade needs, benchmark what it supports, ' +
        'and decide whether its diagnostics are shared.',
    examples: ['darkgrade doctor', 'darkgrade cameras', 'darkgrade telemetry benchmark', 'darkgrade telemetry status'],
    commands: [
        {
            name: 'cameras',
            summary: 'List the cameras attached over USB',
            description:
                'Lists each attached camera with its USB id and whether it is ready for computer control. ' +
                'Nothing is opened: no session starts and no setting is read.',
            section: 'Camera',
            flags: [json],
            examples: ['darkgrade cameras', 'darkgrade cameras --json'],
        },
        {
            name: 'doctor',
            summary: 'Check this computer and any attached camera',
            description:
                'Checks the Node version, the settings folder, the USB driver and the attached cameras, ' +
                'and says how to fix what it finds. Paste its output into a bug report.',
            section: 'Camera',
            flags: [json],
            examples: ['darkgrade doctor', 'darkgrade doctor --json'],
        },
        cameraCommands,
        telemetry,
        {
            name: 'completions',
            summary: 'Print a shell completion script',
            description: 'Prints a script that completes commands and flags when you press Tab.',
            section: 'Shell',
            arguments: [{ name: 'shell', required: true, choices: completionShells }],
            examples: [
                'darkgrade completions zsh > ~/.zfunc/_darkgrade',
                'darkgrade completions bash > ~/.local/share/bash-completion/completions/darkgrade',
                'darkgrade completions fish > ~/.config/fish/completions/darkgrade.fish',
            ],
        },
        {
            name: 'man',
            summary: 'Open the manual page',
            description: 'Opens the manual page on a terminal and prints its roff source when piped.',
            section: 'Shell',
            examples: ['darkgrade man', 'darkgrade man > darkgrade.1'],
        },
        {
            name: 'help',
            summary: 'Show help for a command',
            section: 'Shell',
            arguments: [{ name: 'command', required: false }],
            examples: ['darkgrade help telemetry benchmark'],
        },
        {
            name: 'version',
            summary: 'Print the version',
            description: 'Prints the version. With --json it adds the Node version and platform.',
            section: 'Shell',
            flags: [json],
        },
    ],
}

export const visibleFlags = (command: CommandDefinition) => (command.flags ?? []).filter(flag => !flag.hidden)

/** A short choice list is spelled out; a long one (every drive mode a brand names) keeps the argument's name. */
export const argumentUsage = (argument: ArgumentDefinition) => {
    const choices = argument.choices?.join('|')
    const name = choices && choices.length <= 40 ? choices : argument.name
    return argument.required ? `<${name}>` : `[${name}]`
}

/** Follows the words down the tree and stops at the first one that names no command. */
export function resolveCommand(words: readonly string[]): { path: CommandDefinition[]; remaining: string[] } {
    const path = [rootCommand]
    let index = 0
    for (; index < words.length; index++) {
        const next = path[path.length - 1].commands?.find(command => command.name === words[index])
        if (!next) break
        path.push(next)
    }
    return { path, remaining: words.slice(index) }
}

export const commandLine = (path: readonly CommandDefinition[]) => path.map(command => command.name).join(' ')

function editDistance(left: string, right: string): number {
    let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
    for (let row = 1; row <= left.length; row++) {
        const current = [row]
        for (let column = 1; column <= right.length; column++)
            current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1))
        previous = current
    }
    return previous[right.length]
}

/** The single closest candidate, when it is close enough to be a typo rather than another word. */
export function closestMatch(word: string, candidates: readonly string[]): string | undefined {
    const ranked = candidates
        .map(candidate => ({ candidate, distance: editDistance(word.toLowerCase(), candidate) }))
        .sort((left, right) => left.distance - right.distance)
    const best = ranked[0]
    if (!best || best.distance > Math.max(1, Math.floor(best.candidate.length / 3))) return undefined
    return ranked[1]?.distance === best.distance ? undefined : best.candidate
}
