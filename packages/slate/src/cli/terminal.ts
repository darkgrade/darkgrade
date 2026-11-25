import { emitKeypressEvents } from 'node:readline'
import { createInterface } from 'node:readline/promises'

/** Flags that apply to every command and may appear anywhere before `--`. */
export interface GlobalFlags {
    help: boolean
    version: boolean
    noColor: boolean
    noInput: boolean
    noProgress: boolean
    quiet: boolean
}

export interface TerminalInput {
    isTTY?: boolean
    setRawMode?(enabled: boolean): unknown
    on(event: string, listener: (...values: never[]) => void): unknown
    removeListener(event: string, listener: (...values: never[]) => void): unknown
    resume(): unknown
    pause(): unknown
}

export interface TerminalOutput {
    isTTY?: boolean
    columns?: number
    write(text: string): unknown
}

export interface TerminalStreams {
    input: TerminalInput
    output: TerminalOutput
    error: TerminalOutput
    environment: Record<string, string | undefined>
}

export interface Paint {
    bold(text: string): string
    dim(text: string): string
    red(text: string): string
    green(text: string): string
    yellow(text: string): string
    /** Darkgrade gold where the terminal has 24-bit colour, yellow otherwise. */
    accent(text: string): string
}

/** A transient status line on a terminal; one plain line per change everywhere else. */
export interface Progress {
    /** Replaces the status line. */
    update(text: string): void
    /** Prints a line that stays, above the status line. */
    note(line: string): void
    /** Removes the status line, so results and errors are not drawn over it. */
    stop(): void
}

export interface Choice<Value> {
    label: string
    hint?: string
    value: Value
}

export interface Terminal {
    /** Results: standard output. */
    print(text: string): void
    /** Messages, warnings and errors: standard error. */
    report(text: string): void
    out: Paint
    err: Paint
    /** Standard output is a terminal, so a person is reading it and not a program. */
    readable: boolean
    /** Questions may be asked: both ends are terminals and nothing disabled prompts. */
    interactive: boolean
    animated: boolean
    quiet: boolean
    columns: number
    progress(): Progress
    confirm(question: string): Promise<boolean>
    ask(question: string): Promise<string>
    /** Resolves undefined when the person cancels with Escape, q or Ctrl-C. */
    select<Value>(title: string, choices: readonly Choice<Value>[]): Promise<Value | undefined>
}

const set = (value: string | undefined) => value !== undefined && value !== ''

/** `--no-color`, then NO_COLOR, then FORCE_COLOR, then TERM=dumb, then whether the stream is a terminal. */
export function colorEnabled(
    stream: { isTTY?: boolean },
    environment: Record<string, string | undefined>,
    noColorFlag: boolean
): boolean {
    if (noColorFlag || set(environment.NO_COLOR)) return false
    if (set(environment.FORCE_COLOR)) return environment.FORCE_COLOR !== '0' && environment.FORCE_COLOR !== 'false'
    if (environment.TERM === 'dumb') return false
    return !!stream.isTTY
}

function paint(enabled: boolean, trueColor: boolean): Paint {
    const wrap = (open: string, close: string) => (text: string) =>
        enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text
    return {
        bold: wrap('1', '22'),
        dim: wrap('2', '22'),
        red: wrap('31', '39'),
        green: wrap('32', '39'),
        yellow: wrap('33', '39'),
        accent: wrap(trueColor ? '38;2;245;205;138' : '33', '39'),
    }
}

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const spinnerIntervalMilliseconds = 80
const clearLine = '\r\u001b[2K'
const hideCursor = '\u001b[?25l'
const showCursor = '\u001b[?25h'

export const defaultStreams = (): TerminalStreams => ({
    input: process.stdin as unknown as TerminalInput,
    output: process.stdout,
    error: process.stderr,
    environment: process.env,
})

export function createTerminal(
    flags: Pick<GlobalFlags, 'noColor' | 'noInput' | 'noProgress' | 'quiet'>,
    streams: TerminalStreams = defaultStreams()
): Terminal {
    const { input, output, error, environment } = streams
    const automated = set(environment.CI) || environment.TERM === 'dumb'
    const trueColor = /^(truecolor|24bit)$/.test(environment.COLORTERM ?? '')
    const err = paint(colorEnabled(error, environment, flags.noColor), trueColor)
    const interactive = !!input.isTTY && !!error.isTTY && !flags.noInput && !automated
    const animated =
        !!error.isTTY && !automated && !flags.noProgress && !flags.quiet && !set(environment.DARKGRADE_NO_SPINNER)
    const columns = Number(environment.COLUMNS) || output.columns || 80

    const animatedProgress = (): Progress => {
        let text = ''
        let frame = 0
        let timer: ReturnType<typeof setInterval> | undefined
        const draw = () => {
            const line = `${spinnerFrames[frame % spinnerFrames.length]} ${text}`
            error.write(`${clearLine}${err.accent(line.slice(0, 1))}${line.slice(1, (error.columns ?? 80) - 1)}`)
        }
        const stop = () => {
            if (!timer) return
            clearInterval(timer)
            timer = undefined
            error.write(clearLine + showCursor)
        }
        return {
            update(next) {
                text = next
                if (!timer) {
                    error.write(hideCursor)
                    timer = setInterval(() => {
                        frame++
                        draw()
                    }, spinnerIntervalMilliseconds)
                }
                draw()
            },
            note(line) {
                error.write(`${timer ? clearLine : ''}${line}\n`)
                if (timer) draw()
            },
            stop,
        }
    }

    const plainProgress = (): Progress => {
        let previous = ''
        return {
            update(next) {
                if (flags.quiet || next === previous) return
                previous = next
                error.write(next + '\n')
            },
            note(line) {
                error.write(line + '\n')
            },
            stop() {},
        }
    }

    const question = async (prompt: string) => {
        const readline = createInterface({
            input: input as unknown as NodeJS.ReadableStream,
            output: error as unknown as NodeJS.WritableStream,
        })
        try {
            return (await readline.question(prompt)).trim()
        } finally {
            readline.close()
        }
    }

    const select = <Value>(title: string, choices: readonly Choice<Value>[]) =>
        new Promise<Value | undefined>(resolve => {
            let selected = 0
            let drawn = false
            const draw = () => {
                const rows = choices.map((choice, index) => {
                    const pointer = index === selected ? err.accent('❯') : ' '
                    const label = index === selected ? err.bold(choice.label) : choice.label
                    return `${pointer} ${err.dim(`${index + 1}.`)} ${label}${choice.hint ? '  ' + err.dim(choice.hint) : ''}`
                })
                const lines = [
                    `${err.accent('?')} ${err.bold(title)} ${err.dim('↑/↓ or a number, Enter to choose, Esc to cancel')}`,
                    ...rows,
                ]
                error.write(
                    (drawn ? `\u001b[${lines.length}A` : hideCursor) +
                        lines.map(line => clearLine + line + '\n').join('')
                )
                drawn = true
            }
            const finish = (value: Value | undefined) => {
                input.removeListener('keypress', onKeypress)
                input.setRawMode?.(false)
                input.pause()
                error.write(showCursor)
                resolve(value)
            }
            const onKeypress = (character: string | undefined, key: { name?: string; ctrl?: boolean } = {}) => {
                const digit = Number(character)
                if (key.name === 'return') return finish(choices[selected].value)
                if (key.name === 'escape' || character === 'q' || (key.ctrl && key.name === 'c'))
                    return finish(undefined)
                if (digit >= 1 && digit <= choices.length) return finish(choices[digit - 1].value)
                if (key.name === 'up' || character === 'k') selected = (selected + choices.length - 1) % choices.length
                else if (key.name === 'down' || character === 'j') selected = (selected + 1) % choices.length
                else return
                draw()
            }
            emitKeypressEvents(input as unknown as NodeJS.ReadableStream)
            input.setRawMode?.(true)
            input.resume()
            input.on('keypress', onKeypress as (...values: never[]) => void)
            draw()
        })

    return {
        print: text => void output.write(text + '\n'),
        report: text => void error.write(text + '\n'),
        out: paint(colorEnabled(output, environment, flags.noColor), trueColor),
        err,
        readable: !!output.isTTY,
        interactive,
        animated,
        quiet: flags.quiet,
        columns,
        progress: animated ? animatedProgress : plainProgress,
        confirm: async prompt =>
            /^y(es)?$/i.test(await question(`${err.accent('?')} ${err.bold(prompt)} ${err.dim('[y/N]')} `)),
        ask: prompt => question(`${err.accent('?')} ${err.bold(prompt)} `),
        select,
    }
}
