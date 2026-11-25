import type { TerminalStreams } from '@cli/terminal'
import { PassThrough } from 'node:stream'

/** Terminal streams that record what is written; `terminal` makes every end a TTY. */
export function streams(options: { terminal: boolean; environment?: Record<string, string | undefined> } = { terminal: false }) {
    const written = { output: '', error: '' }
    const input = Object.assign(new PassThrough(), { isTTY: options.terminal, setRawMode: () => undefined })
    const value: TerminalStreams = {
        input: input as unknown as TerminalStreams['input'],
        output: { isTTY: options.terminal, write: text => (written.output += text) },
        error: { isTTY: options.terminal, columns: 200, write: text => (written.error += text) },
        environment: options.environment ?? {},
    }
    return { value, written, input }
}
