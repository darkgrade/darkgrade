import { commandLine, documentationUrl, globalFlags, issuesUrl, programName, rootCommand, visibleFlags } from '@cli/commands'
import type { CommandDefinition, FlagDefinition } from '@cli/commands'
import { usageLine } from '@cli/help'

/** roff reads a leading period or apostrophe as a request and a backslash as an escape. */
const roff = (text: string) => text.replaceAll('\\', '\\e').replaceAll('-', '\\-').replace(/^([.'])/gm, '\\&$1')

const flagEntry = (flag: FlagDefinition) => [
    '.TP',
    `${flag.short ? `\\fB\\-${flag.short}\\fR, ` : ''}\\fB${roff(`--${flag.name}`)}\\fR${flag.value ? ` \\fI${roff(flag.value)}\\fR` : ''}`,
    roff(flag.summary),
]

function leafCommands(command: CommandDefinition, path: CommandDefinition[]): CommandDefinition[][] {
    const here = [...path, command]
    return command.commands ? command.commands.flatMap(child => leafCommands(child, here)) : [here]
}

/** The manual page as roff source, section 1. `npm install -g` installs it for `man darkgrade`. */
export function manualPage(version = 'development'): string {
    const commands = (rootCommand.commands ?? []).flatMap(command => leafCommands(command, [rootCommand]))
    return [
        `.TH ${programName.toUpperCase()} 1 "" "${programName} ${roff(version)}" "Darkgrade"`,
        '.SH NAME',
        `${programName} \\- ${roff(rootCommand.summary.toLowerCase())}`,
        '.SH SYNOPSIS',
        `\\fB${programName}\\fR \\fIcommand\\fR [\\fIoptions\\fR]`,
        '.SH DESCRIPTION',
        roff(rootCommand.description ?? rootCommand.summary),
        '.SH COMMANDS',
        ...commands.flatMap(path => {
            const command = path[path.length - 1]
            return [
                '.SS ' + roff(usageLine(path)),
                roff(command.description ?? command.summary),
                ...visibleFlags(command).flatMap(flagEntry),
                ...(command.examples ?? []).flatMap(example => ['.PP', '.nf', `    $ ${roff(example)}`, '.fi']),
            ]
        }),
        '.SH OPTIONS',
        'These apply to every command and may appear anywhere before \\fB\\-\\-\\fR.',
        ...globalFlags.flatMap(flagEntry),
        '.SH ENVIRONMENT',
        ...[
            ['NO_COLOR', 'Any value turns colour off.'],
            ['FORCE_COLOR', 'Any value except 0 keeps colour when output is piped.'],
            ['CI', 'Any value turns the spinner and every question off.'],
            ['DARKGRADE_NO_SPINNER', 'Any value replaces the spinner with one plain line for each step.'],
            ['DARKGRADE_CAMERA', 'The USB device to use, as VID:PID, when several cameras are attached.'],
            ['DARKGRADE_HOME', 'The settings folder. The default is ~/.darkgrade, shared with Darkgrade Studio.'],
            ['DARKGRADE_CONTRIBUTIONS, DO_NOT_TRACK', 'DARKGRADE_CONTRIBUTIONS=0 or DO_NOT_TRACK=1 stops sharing whatever the saved preference.'],
            ['DARKGRADE_TELEMETRY_URL', 'The collector origin, for a private deployment.'],
        ].flatMap(([name, text]) => ['.TP', `\\fB${roff(name)}\\fR`, roff(text)]),
        '.SH EXIT STATUS',
        '.TP',
        '\\fB0\\fR',
        'The command succeeded.',
        '.TP',
        '\\fB1\\fR',
        'The command failed, a check did not pass, or the arguments were not understood.',
        '.SH FILES',
        '.TP',
        '\\fI~/.darkgrade/settings.json\\fR',
        'The sharing preference and installation identity.',
        '.TP',
        '\\fI~/.darkgrade/profiles/\\fR',
        'Camera profiles saved by the benchmark.',
        '.SH SEE ALSO',
        roff(`Documentation: ${documentationUrl}`),
        '.PP',
        roff(`Report a problem: ${issuesUrl}`),
        '.PP',
        roff(`Every command explains itself: ${commandLine([rootCommand])} help command`),
        '',
    ].join('\n')
}
