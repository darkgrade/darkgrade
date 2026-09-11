export type LoggerConfig = {
    expanded?: boolean
    captureConsole?: boolean
    renderInTerminal?: boolean
}

export const defaultLoggerConfig: LoggerConfig = {
    expanded: true,
    captureConsole: true,
    renderInTerminal: true,
}
