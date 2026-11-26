export type LoggerConfig = {
    expanded?: boolean
    captureConsole?: boolean
    renderInTerminal?: boolean
    /** Transactions kept in memory; older ones are dropped, with any data they carried. */
    maxTransactions?: number
}

/** Inert by default: a logger takes over the console or draws in the terminal only when asked. */
export const defaultLoggerConfig: LoggerConfig = {
    expanded: true,
    captureConsole: false,
    renderInTerminal: false,
    maxTransactions: 1000,
}
