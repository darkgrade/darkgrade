export type LoggerConfig = {
    expanded?: boolean
    captureConsole?: boolean
    renderInTerminal?: boolean
    /** Transactions kept in memory; older ones are dropped, with any data they carried. */
    maxTransactions?: number
}

export const defaultLoggerConfig: LoggerConfig = {
    expanded: true,
    captureConsole: true,
    renderInTerminal: true,
    maxTransactions: 1000,
}
