import {
    globalFlags,
    programName,
    rootCommand,
    visibleFlags,
    type CommandDefinition,
    type CompletionShell,
} from '@cli/commands'

interface CompletionNode {
    /** The command words typed so far, without the program name. */
    words: string[]
    candidates: { word: string; summary: string; takesValue?: boolean }[]
}

function completionNodes(command: CommandDefinition = rootCommand, words: string[] = []): CompletionNode[] {
    const flags = [...visibleFlags(command), ...globalFlags].map(flag => ({
        word: `--${flag.name}`,
        summary: flag.summary,
        takesValue: !!flag.value,
    }))
    const children = (command.commands ?? []).map(child => ({ word: child.name, summary: child.summary }))
    const first = command.arguments?.[0]
    const choices = (first?.choices ?? []).map(choice => ({ word: choice, summary: first!.name }))
    // `darkgrade help <command>` completes the same names as the root.
    const helpTopics =
        command.name === 'help'
            ? (rootCommand.commands ?? []).map(child => ({ word: child.name, summary: child.summary }))
            : []
    return [
        { words, candidates: [...children, ...choices, ...helpTopics, ...flags] },
        ...(command.commands ?? []).flatMap(child => completionNodes(child, [...words, child.name])),
    ]
}

/** Deepest paths first, so a shell `case` reaches the most specific pattern before its parent. */
const deepestFirst = () => completionNodes().sort((left, right) => right.words.length - left.words.length)

const singleQuoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

function bashScript(): string {
    const cases = deepestFirst().map(node => {
        const pattern = node.words.length ? `"${node.words.join(' ')}"*` : '*'
        return `        ${pattern}) candidates="${node.candidates.map(candidate => candidate.word).join(' ')}" ;;`
    })
    return `# bash completion for ${programName}
_${programName}() {
    local current="\${COMP_WORDS[COMP_CWORD]}" commandPath="" candidates="" word index
    for ((index = 1; index < COMP_CWORD; index++)); do
        word="\${COMP_WORDS[index]}"
        [[ "$word" == -* ]] || commandPath="\${commandPath:+$commandPath }$word"
    done
    case "$commandPath" in
${cases.join('\n')}
    esac
    COMPREPLY=($(compgen -W "$candidates" -- "$current"))
}
complete -F _${programName} ${programName}
`
}

function zshScript(): string {
    const describe = (candidate: { word: string; summary: string }) =>
        singleQuoted(`${candidate.word.replaceAll(':', '\\:')}:${candidate.summary.replaceAll(':', '\\:')}`)
    const cases = deepestFirst().map(node => {
        const pattern = node.words.length ? `"${node.words.join(' ')}"*` : '*'
        return `        ${pattern}) candidates=(${node.candidates.map(describe).join(' ')}) ;;`
    })
    return `#compdef ${programName}
# zsh completion for ${programName}
_${programName}() {
    local -a commandWords candidates
    local word
    for word in "\${(@)words[2,CURRENT-1]}"; do
        [[ "$word" == -* ]] || commandWords+=("$word")
    done
    case "\${(j: :)commandWords}" in
${cases.join('\n')}
    esac
    _describe '${programName}' candidates
}
if [ "$funcstack[1]" = "_${programName}" ]; then
    _${programName} "$@"
else
    compdef _${programName} ${programName}
fi
`
}

function fishScript(): string {
    const lines = [`# fish completion for ${programName}`, `complete -c ${programName} -f`]
    for (const node of completionNodes()) {
        const seen = node.words.map(word => `__fish_seen_subcommand_from ${word}`)
        const children = node.candidates
            .filter(candidate => !candidate.word.startsWith('-'))
            .map(candidate => candidate.word)
        const notDeeper = children.length ? [`not __fish_seen_subcommand_from ${children.join(' ')}`] : []
        const condition = node.words.length ? [...seen, ...notDeeper].join('; and ') : '__fish_use_subcommand'
        for (const candidate of node.candidates) {
            const flag = `-l ${candidate.word.slice(2)}${candidate.takesValue ? ' -r' : ''}`
            const target = candidate.word.startsWith('--') ? flag : `-a ${candidate.word}`
            // Global flags are offered at every depth by the root's own entries.
            if (
                candidate.word.startsWith('--') &&
                node.words.length &&
                globalFlags.some(flag => `--${flag.name}` === candidate.word)
            )
                continue
            const when = candidate.word.startsWith('--') && !node.words.length ? '' : ` -n ${singleQuoted(condition)}`
            lines.push(`complete -c ${programName}${when} ${target} -d ${singleQuoted(candidate.summary)}`)
        }
    }
    return lines.join('\n') + '\n'
}

export function completionScript(shell: CompletionShell): string {
    return { bash: bashScript, zsh: zshScript, fish: fishScript }[shell]()
}
