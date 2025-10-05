export type LoggerConfig = {
    // Filtering
    minLevel: 'debug' | 'info' | 'warn' | 'error'
    excludeOperations?: string[]
    includeOperations?: string[] // if set, ONLY show these operations

    // Display
    collapse: boolean // default: false (hides params/phases)
    expandOnError: boolean // default: true (override collapse on error)
    collapseUSB: boolean // default: true (hide USB details even when expanded)
    showEncodedData: boolean // default: false
    showDecodedData: boolean // default: true

    // Storage
    maxLogs?: number // max number of transactions to keep (undefined = keep all)
}

export const defaultLoggerConfig: LoggerConfig = {
    minLevel: 'debug',
    collapse: false,
    expandOnError: true,
    collapseUSB: true,
    showEncodedData: false,
    showDecodedData: true,
}
