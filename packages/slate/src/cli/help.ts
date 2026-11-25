import {
    argumentUsage,
    commandLine,
    documentationUrl,
    globalFlags,
    issuesUrl,
    visibleFlags,
    type CommandDefinition,
    type FlagDefinition,
} from '@cli/commands'
import type { Paint } from '@cli/terminal'

export const flagLabel = (flag: FlagDefinition) =>
    `${flag.short ? `-${flag.short}, ` : '    '}--${flag.name}${flag.value ? ` <${flag.value}>` : ''}`

export function usageLine(path: readonly CommandDefinition[]): string {
    const command = path[path.length - 1]
    return [
        commandLine(path),
        ...(command.commands ? ['<command>'] : []),
        ...(command.arguments ?? []).map(argumentUsage),
        ...(command.commands || visibleFlags(command).length ? ['[options]'] : []),
    ].join(' ')
}

function wrap(text: string, width: number): string[] {
    const lines: string[] = []
    let line = ''
    for (const word of text.split(' ')) {
        if (line && line.length + word.length + 1 > width) {
            lines.push(line)
            line = word
        } else line = line ? `${line} ${word}` : word
    }
    return line ? [...lines, line] : lines
}

/** Two columns: the label padded to the widest one, the summary wrapped beside it. */
function rows(entries: readonly (readonly [string, string])[], paint: Paint, columns: number): string[] {
    const labelWidth = Math.max(...entries.map(([label]) => label.length))
    const summaryWidth = Math.max(24, columns - labelWidth - 4)
    return entries.flatMap(([label, summary]) =>
        wrap(summary, summaryWidth).map(
            (line, index) => `  ${index ? ' '.repeat(labelWidth) : paint.accent(label.padEnd(labelWidth))}  ${line}`
        )
    )
}

/** Leaf commands under a group are listed by their full path, so one screen shows the whole tree. */
function listedCommands(command: CommandDefinition, prefix = ''): { label: string; command: CommandDefinition }[] {
    return (command.commands ?? []).flatMap(child =>
        child.commands && !prefix
            ? listedCommands(child, `${child.name} `)
            : [
                  {
                      label: [prefix + child.name, ...(child.arguments ?? []).map(argumentUsage)].join(' '),
                      command: child,
                  },
              ]
    )
}

export function renderHelp(
    path: readonly CommandDefinition[],
    paint: Paint,
    options: { version?: string; columns?: number } = {}
): string {
    const command = path[path.length - 1]
    const columns = Math.min(options.columns ?? 80, 100)
    const heading = (text: string) => paint.bold(text)
    const isRoot = path.length === 1
    const sections: string[][] = [
        [
            isRoot
                ? `${paint.bold(command.name)}${options.version ? ` ${paint.dim(options.version)}` : ''}  ${command.summary}`
                : command.summary,
        ],
        ...(command.description ? [wrap(command.description, columns)] : []),
        [heading('Usage'), `  ${usageLine(path)}`],
    ]
    if (command.examples?.length)
        sections.push([heading('Examples'), ...command.examples.map(example => `  ${paint.dim('$')} ${example}`)])
    const listed = listedCommands(command)
    for (const section of new Set(listed.map(entry => entry.command.section ?? 'Commands')))
        sections.push([
            heading(listed.every(entry => !entry.command.section) ? 'Commands' : section),
            ...rows(
                listed
                    .filter(entry => (entry.command.section ?? 'Commands') === section)
                    .map(entry => [entry.label, entry.command.summary] as const),
                paint,
                columns
            ),
        ])
    const flags = visibleFlags(command)
    if (flags.length)
        sections.push([
            heading('Options'),
            ...rows(
                flags.map(flag => [flagLabel(flag), flag.summary] as const),
                paint,
                columns
            ),
        ])
    sections.push([
        heading('Global options'),
        ...rows(
            globalFlags.map(flag => [flagLabel(flag), flag.summary] as const),
            paint,
            columns
        ),
    ])
    sections.push(
        isRoot
            ? [
                  heading('Learn more'),
                  `  ${paint.dim('Help for a command')}  darkgrade help <command>`,
                  `  ${paint.dim('Documentation')}       ${documentationUrl}`,
                  `  ${paint.dim('Report a problem')}    ${issuesUrl}`,
              ]
            : [paint.dim(`Documentation: ${documentationUrl}`)]
    )
    return sections.map(section => section.join('\n')).join('\n\n')
}
