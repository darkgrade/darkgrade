import { OperationDefinition } from '@ptp/types/operation'
import { OperationName, OperationParamsObject, GetOperation } from '@camera/generic-camera'
import { CodecType } from '@ptp/types/codec'
import { LoggerConfig, defaultLoggerConfig } from './logger-config'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type BaseLog = {
    id: number
    timestamp: number
    level: LogLevel
}

type PTPOperationLog<
    Ops extends readonly OperationDefinition[],
    N extends OperationName<Ops> = OperationName<Ops>
> = BaseLog & {
    type: 'ptp_operation'
    sessionId: number
    transactionId: number

    requestPhase: {
        timestamp: number
        operationName: N
        encodedParams?: Uint8Array[]
        decodedParams: OperationParamsObject<GetOperation<N, Ops>>
    }

    dataPhase?: {
        timestamp: number
        direction: 'in' | 'out'
        bytes: number
        encodedData?: Uint8Array
        decodedData?: GetOperation<N, Ops>['dataCodec'] extends infer C ? (C extends { type: any } ? CodecType<C> : unknown) : unknown
        maxDataLength?: number
    }

    responsePhase?: {
        timestamp: number
        code: number
    }
}

type USBTransferLog = BaseLog & {
    type: 'usb_transfer'
    direction: 'send' | 'receive'
    bytes: number
    endpoint: 'bulkIn' | 'bulkOut' | 'interrupt'
    endpointAddress: string

    sessionId: number
    transactionId: number
    phase: 'request' | 'data' | 'response'
}

type ConsoleLog = BaseLog & {
    type: 'console'
    consoleLevel: 'log' | 'error' | 'info' | 'warn'
    args: any[]
}

type PTPTransferLog<
    Ops extends readonly OperationDefinition[],
    N extends OperationName<Ops> = OperationName<Ops>
> = PTPOperationLog<Ops, N> & {
    type: 'ptp_transfer'
    objectHandle: number
    totalBytes: number
    transferredBytes: number
    chunks: Array<{
        transactionId: number
        timestamp: number
        offset: number
        bytes: number
    }>
}

type Log<Ops extends readonly OperationDefinition[]> = PTPOperationLog<Ops> | USBTransferLog | PTPTransferLog<Ops> | ConsoleLog

// Before adding to logger (no id/timestamp yet)
type NewLog<Ops extends readonly OperationDefinition[]> = Omit<Log<Ops>, 'id' | 'timestamp'>

export class Logger<Ops extends readonly OperationDefinition[] = readonly OperationDefinition[]> {
    private logs: Map<string, Log<Ops>[]> = new Map() // key: "sessionId:transactionId"
    private orderedTransactions: Array<{
        key: string // "sessionId:transactionId"
        timestamp: number // earliest timestamp in this transaction
    }> = []
    private config: LoggerConfig
    private nextId: number = 1
    private changeListeners: Array<() => void> = []
    private notifyTimeout: NodeJS.Timeout | null = null
    private inkInstance: any = null
    private activeTransfers: Map<number, number> = new Map() // objectHandle -> logId
    private originalConsole = {
        log: console.log.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
    }

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...defaultLoggerConfig, ...config }

        // Auto-render ink logger in Node.js environment
        if (typeof window === 'undefined' && typeof process !== 'undefined') {
            this.captureConsole()
            this.setupInkRenderer()
            this.setupProcessHandlers()
        }
    }

    private captureConsole() {
        const createWrapper = (consoleLevel: 'log' | 'error' | 'info' | 'warn') => {
            return (...args: any[]) => {
                // Add to logger as a console log entry
                this.addLog({
                    type: 'console',
                    level: 'info',
                    consoleLevel,
                    args,
                } as Omit<ConsoleLog, 'id' | 'timestamp'>)
            }
        }

        console.log = createWrapper('log')
        console.error = createWrapper('error')
        console.info = createWrapper('info')
        console.warn = createWrapper('warn')
    }

    private setupProcessHandlers() {
        // Cleanup on SIGINT (Ctrl+C)
        process.on('SIGINT', () => {
            this.cleanup()
            process.exit(0)
        })

        // Cleanup on SIGTERM
        process.on('SIGTERM', () => {
            this.cleanup()
            process.exit(0)
        })

        // Cleanup on exit (after all async operations complete)
        process.on('exit', () => {
            this.cleanup()
        })
    }

    private setupInkRenderer() {
        // Dynamically import to avoid bundling issues in browser
        import('react').then(React => {
            import('ink').then(({ render }) => {
                import('./renderers/ink-simple').then(({ InkSimpleLogger }) => {
                    this.inkInstance = render(
                        React.createElement(InkSimpleLogger, { logger: this as any }),
                        { patchConsole: false }
                    )
                }).catch(() => {
                    // Ink renderer not available, continue without UI
                })
            }).catch(() => {
                // Ink not available, continue without UI
            })
        }).catch(() => {
            // React not available, continue without UI
        })
    }

    onChange(listener: () => void) {
        this.changeListeners.push(listener)
    }

    private notifyChange() {
        // Debounce notifications - batch rapid updates
        if (this.notifyTimeout) {
            clearTimeout(this.notifyTimeout)
        }
        this.notifyTimeout = setTimeout(() => {
            for (const listener of this.changeListeners) {
                listener()
            }
            this.notifyTimeout = null
        }, 10) // Wait 10ms for more updates before notifying
    }

    private getKey(sessionId: number, transactionId: number): string {
        return `${sessionId}:${transactionId}`
    }

    addLog(log: Omit<PTPOperationLog<Ops>, 'id' | 'timestamp'>): number
    addLog(log: Omit<USBTransferLog, 'id' | 'timestamp'>): number
    addLog(log: Omit<ConsoleLog, 'id' | 'timestamp'>): number
    addLog(log: NewLog<Ops>): number {
        const id = this.nextId++
        const timestamp = Date.now()
        const fullLog = { ...log, id, timestamp } as Log<Ops>

        // Console logs don't have sessionId/transactionId, handle separately
        if (log.type === 'console') {
            // Store console logs with a special key
            const key = `console:${id}`
            this.logs.set(key, [fullLog])
            this.orderedTransactions.push({ key, timestamp })
        } else {
            const key = this.getKey((log as any).sessionId, (log as any).transactionId)
            const existing = this.logs.get(key)

            if (!existing) {
                // New transaction
                this.logs.set(key, [fullLog])
                this.orderedTransactions.push({ key, timestamp })
            } else {
                // Add to existing transaction
                existing.push(fullLog)
            }
        }

        this.trimIfNeeded()
        this.notifyChange()
        return id
    }

    updateLog(id: number, updates: Partial<Log<Ops>>): number {
        // Find log by ID across all transactions
        for (const logs of this.logs.values()) {
            const index = logs.findIndex(l => l.id === id)
            if (index !== -1) {
                logs[index] = { ...logs[index], ...updates } as Log<Ops>
                this.notifyChange()
                break
            }
        }
        return id
    }

    getLogs(): Log<Ops>[] {
        return Array.from(this.logs.values()).flat()
    }

    getLogById(id: number): Log<Ops> | undefined {
        for (const logs of this.logs.values()) {
            const found = logs.find(l => l.id === id)
            if (found) return found
        }
        return undefined
    }

    getLogsByTransaction(sessionId: number, transactionId: number): Log<Ops>[] {
        return this.logs.get(this.getKey(sessionId, transactionId)) || []
    }

    setConfig(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config }
    }

    getConfig(): LoggerConfig {
        return this.config
    }

    cleanup(): void {
        if (this.inkInstance) {
            this.inkInstance.unmount()
            this.inkInstance = null
        }

        // Restore console
        console.log = this.originalConsole.log
        console.error = this.originalConsole.error
        console.info = this.originalConsole.info
        console.warn = this.originalConsole.warn
    }

    clear(): void {
        this.logs.clear()
        this.orderedTransactions = []
        this.activeTransfers.clear()
        this.nextId = 1
    }

    getActiveTransfer(objectHandle: number): number | undefined {
        return this.activeTransfers.get(objectHandle)
    }

    registerTransfer(objectHandle: number, logId: number): void {
        this.activeTransfers.set(objectHandle, logId)
    }

    completeTransfer(objectHandle: number): void {
        this.activeTransfers.delete(objectHandle)
    }

    private trimIfNeeded(): void {
        if (!this.config.maxLogs || this.orderedTransactions.length <= this.config.maxLogs) return

        const toDelete = this.orderedTransactions.slice(0, this.orderedTransactions.length - this.config.maxLogs)
        toDelete.forEach(({ key }) => this.logs.delete(key))
        this.orderedTransactions = this.orderedTransactions.slice(-this.config.maxLogs)
    }
}

export type { LogLevel, BaseLog, PTPOperationLog, USBTransferLog, PTPTransferLog, ConsoleLog, Log, NewLog }
