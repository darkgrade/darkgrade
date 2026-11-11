import { Registry } from '@ptp/registry'
import { LoggerConfig, defaultLoggerConfig } from './logger-config'

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

type DecodedData = number | bigint | string | Uint8Array | object | number[] | null | undefined

type BaseLog = {
    id: number
    timestamp: number
    level: LogLevel
}

type PTPOperationLog = BaseLog & {
    type: 'ptp_operation'
    sessionId: number
    transactionId: number

    requestPhase: {
        timestamp: number
        operationName: string
        encodedParams?: Uint8Array[]
        decodedParams: Record<string, number | bigint | string | object>
    }

    dataPhase?: {
        timestamp: number
        direction: 'in' | 'out'
        bytes: number
        encodedData?: Uint8Array
        decodedData?: DecodedData
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
    status: USBTransferStatus
}

type ConsoleLog = BaseLog & {
    type: 'console'
    consoleLevel: 'log' | 'error' | 'info' | 'warn'
    args: (number | bigint | string | boolean | null | undefined | object)[]
}

type PTPTransferLog = Omit<PTPOperationLog, 'type'> & {
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

type PTPEventLog = BaseLog & {
    type: 'ptp_event'
    sessionId: number
    eventCode: number
    eventName: string
    encodedParams: number[]
    decodedParams: Record<string, number | bigint | string>
}

type Log = PTPOperationLog | USBTransferLog | PTPTransferLog | ConsoleLog | PTPEventLog

type NewLog =
    | Omit<PTPOperationLog, 'id' | 'timestamp'>
    | Omit<USBTransferLog, 'id' | 'timestamp'>
    | Omit<PTPTransferLog, 'id' | 'timestamp'>
    | Omit<ConsoleLog, 'id' | 'timestamp'>
    | Omit<PTPEventLog, 'id' | 'timestamp'>

export class Logger {
    private logs: Map<string, Log[]> = new Map()
    private orderedTransactions: Array<{
        key: string
        timestamp: number
    }> = []
    private config: LoggerConfig
    private nextId: number = 1
    private changeListeners: Array<() => void> = []
    private static exitHandlerInstalled = false
    private notifyTimeout: NodeJS.Timeout | null = null
    private activeTransfers: Map<number, number> = new Map()
    /** Which transaction each log id belongs to, so updates find their log without a scan. */
    private logKeys: Map<number, string> = new Map()
    private registry: Registry | null = null
    private originalConsole = {
        log: console.log.bind(console),
        error: console.error.bind(console),
        info: console.info.bind(console),
        warn: console.warn.bind(console),
    }

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...defaultLoggerConfig, ...config }

        if (typeof window === 'undefined' && typeof process !== 'undefined') {
            if (this.config.captureConsole) this.captureConsole()
            if (this.config.renderInTerminal) {
                this.setupInkRenderer()
                this.setupExitHandler()
            }
        }
    }

    private captureConsole() {
        const createWrapper = (consoleLevel: 'log' | 'error' | 'info' | 'warn') => {
            return (...args: (number | bigint | string | boolean | null | undefined | object)[]) => {
                this.addLog({
                    type: 'console',
                    level: 'info',
                    consoleLevel,
                    args,
                })
            }
        }

        console.log = createWrapper('log')
        console.error = createWrapper('error')
        console.info = createWrapper('info')
        console.warn = createWrapper('warn')
    }

    private async setupInkRenderer() {
        const react = await import('react')
        const ink = await import('ink')
        const renderer = await import('./renderers/ink')

        ink.render(react.createElement(renderer.InkLogger, { logger: this }), {
            patchConsole: false,
        })
    }

    private setupExitHandler() {
        // Process-wide handlers: one set no matter how many terminal loggers are created.
        if (Logger.exitHandlerInstalled) return
        Logger.exitHandlerInstalled = true
        const flush = async () => {
            if (this.notifyTimeout) {
                clearTimeout(this.notifyTimeout)
                this.notifyTimeout = null
            }
            for (const listener of this.changeListeners) {
                listener()
            }
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        // Handle exceptions by delaying slightly to let Ink render
        process.on('uncaughtException', async error => {
            await flush()

            console.error(`${error.message}\n\n${error.stack}`)
            // throw error
        })

        process.on('unhandledRejection', async reason => {
            await flush()
            const error = reason instanceof Error ? reason : new Error(String(reason))
            console.error(`${error.message}\n\n${error.stack}`)
            // throw error
        })
    }

    onChange(listener: () => void) {
        this.changeListeners.push(listener)
    }

    private notifyChange() {
        if (this.notifyTimeout) {
            clearTimeout(this.notifyTimeout)
        }
        this.notifyTimeout = setTimeout(() => {
            for (const listener of this.changeListeners) {
                listener()
            }
            this.notifyTimeout = null
        }, 0)
    }

    private getKey(sessionId: number, transactionId: number): string {
        return `${sessionId}:${transactionId}`
    }

    addLog(log: NewLog): number {
        const id = this.nextId++
        const timestamp = Date.now()
        this.logKeys.set(id, this.keyForNewLog(log, id))

        if (log.type === 'console') {
            const consoleLog: ConsoleLog = { ...log, id, timestamp }
            const key = `console:${id}`
            this.logs.set(key, [consoleLog])
            this.orderedTransactions.push({ key, timestamp })
        } else if (log.type === 'ptp_operation') {
            const ptpLog: PTPOperationLog = Object.assign({}, log, { id, timestamp })
            const key = this.getKey(log.sessionId, log.transactionId)
            const existing = this.logs.get(key)
            if (!existing) {
                this.logs.set(key, [ptpLog])
                this.orderedTransactions.push({ key, timestamp })
            } else {
                existing.push(ptpLog)
            }
        } else if (log.type === 'ptp_transfer') {
            const transferLog: PTPTransferLog = Object.assign({}, log, { id, timestamp })
            const key = this.getKey(log.sessionId, log.transactionId)
            const existing = this.logs.get(key)
            if (!existing) {
                this.logs.set(key, [transferLog])
                this.orderedTransactions.push({ key, timestamp })
            } else {
                existing.push(transferLog)
            }
        } else if (log.type === 'usb_transfer') {
            const usbLog: USBTransferLog = Object.assign({}, log, { id, timestamp })
            const key = this.getKey(log.sessionId, log.transactionId)
            const existing = this.logs.get(key)
            if (!existing) {
                this.logs.set(key, [usbLog])
                this.orderedTransactions.push({ key, timestamp })
            } else {
                existing.push(usbLog)
            }
        } else if (log.type === 'ptp_event') {
            const eventLog: PTPEventLog = { ...log, id, timestamp }
            const key = `event:${log.sessionId}:${id}`
            this.logs.set(key, [eventLog])
            this.orderedTransactions.push({ key, timestamp })
        }

        this.trimIfNeeded()
        this.notifyChange()
        return id
    }

    private keyForNewLog(log: NewLog, id: number): string {
        if (log.type === 'console') return `console:${id}`
        if (log.type === 'ptp_event') return `event:${log.sessionId}:${id}`
        return this.getKey(log.sessionId, log.transactionId)
    }

    updateLog(id: number, updates: Partial<Log>): number {
        const key = this.logKeys.get(id)
        const logs = key === undefined ? undefined : this.logs.get(key)
        const index = logs?.findIndex(l => l.id === id) ?? -1
        if (logs && index !== -1) {
            logs[index] = Object.assign({}, logs[index], updates)
            this.notifyChange()
        }
        return id
    }

    getLogs(): Log[] {
        return Array.from(this.logs.values()).flat()
    }

    getOrderedTransactions(): Array<{ key: string; logs: Log[]; timestamp: number }> {
        return this.orderedTransactions.map(({ key, timestamp }) => ({
            key,
            logs: this.logs.get(key) || [],
            timestamp,
        }))
    }

    getLogById(id: number): Log | undefined {
        const key = this.logKeys.get(id)
        return key === undefined ? undefined : this.logs.get(key)?.find(l => l.id === id)
    }

    getLogsByTransaction(sessionId: number, transactionId: number): Log[] {
        return this.logs.get(this.getKey(sessionId, transactionId)) || []
    }

    setConfig(config: Partial<LoggerConfig>): void {
        this.config = { ...this.config, ...config }
    }

    getConfig(): LoggerConfig {
        return this.config
    }

    setRegistry(registry: Registry): void {
        this.registry = registry
    }

    getRegistry(): Registry | null {
        return this.registry
    }

    getResponseRegistry(): Record<string, { code: number; name: string; description: string }> {
        return this.registry?.responses || {}
    }

    clear(): void {
        this.logs.clear()
        this.orderedTransactions = []
        this.activeTransfers.clear()
        this.logKeys.clear()
        this.nextId = 1
    }

    getActiveTransfer(objectHandle: number): number | undefined {
        return this.activeTransfers.get(objectHandle)
    }

    registerTransfer(objectHandle: number, logId: number): void {
        this.activeTransfers.set(objectHandle, logId)
    }

    completeTransfer(objectHandle: number): void {
        const logId = this.activeTransfers.get(objectHandle)
        if (logId !== undefined) {
            // Add response phase to mark transfer as complete
            this.updateLog(logId, {
                responsePhase: {
                    timestamp: Date.now(),
                    code: 0x2001, // OK
                },
            })
        }
        this.activeTransfers.delete(objectHandle)
    }

    startTransfer(
        objectHandle: number,
        sessionId: number,
        transactionId: number,
        operationName: string,
        totalBytes: number
    ): number {
        const transferLog: PTPTransferLog = {
            type: 'ptp_transfer',
            level: 'info',
            id: this.nextId++,
            timestamp: Date.now(),
            sessionId,
            transactionId,
            objectHandle,
            totalBytes,
            transferredBytes: 0,
            chunks: [],
            requestPhase: {
                timestamp: Date.now(),
                operationName,
                encodedParams: [],
                decodedParams: { ObjectHandle: objectHandle },
            },
        }
        // Use object handle in key to avoid collisions for multi-chunk transfers
        const key = `transfer:${sessionId}:${objectHandle}`
        this.logKeys.set(transferLog.id, key)
        this.logs.set(key, [transferLog])
        this.orderedTransactions.push({ key, timestamp: transferLog.timestamp })
        this.registerTransfer(objectHandle, transferLog.id)
        this.notifyChange()
        return transferLog.id
    }

    updateTransferProgress(objectHandle: number, chunkBytes: number, chunkTransactionId: number): void {
        const logId = this.activeTransfers.get(objectHandle)
        if (logId === undefined) return

        const log = this.getLogById(logId)
        if (!log || log.type !== 'ptp_transfer') return

        const chunks = [
            ...log.chunks,
            {
                transactionId: chunkTransactionId,
                timestamp: Date.now(),
                offset: log.transferredBytes,
                bytes: chunkBytes,
            },
        ]

        const transferredBytes = log.transferredBytes + chunkBytes

        this.updateLog(logId, {
            chunks,
            transferredBytes,
            dataPhase: {
                timestamp: Date.now(),
                direction: 'out',
                bytes: transferredBytes,
                maxDataLength: log.totalBytes,
            },
        })
    }

    /**
     * Drops the oldest transactions beyond maxTransactions. Logs keep each response's data, so
     * without this a long live-view session holds every frame it ever received.
     */
    private trimIfNeeded(): void {
        const maximum = this.config.maxTransactions ?? defaultLoggerConfig.maxTransactions!
        // Trim in batches of a tenth, so a full log isn't rebuilt on every new transaction.
        if (this.orderedTransactions.length <= maximum * 1.1) return
        const excess = this.orderedTransactions.length - maximum
        const activeTransferIds = new Set(this.activeTransfers.values())
        const kept: typeof this.orderedTransactions = []
        let dropped = 0
        for (const transaction of this.orderedTransactions) {
            const logs = this.logs.get(transaction.key) ?? []
            const inProgress = logs.some(log => activeTransferIds.has(log.id))
            if (dropped >= excess || inProgress) {
                kept.push(transaction)
                continue
            }
            for (const log of logs) this.logKeys.delete(log.id)
            this.logs.delete(transaction.key)
            dropped++
        }
        this.orderedTransactions = kept
    }
}

export type { BaseLog, ConsoleLog, Log, LogLevel, NewLog, PTPEventLog, PTPOperationLog, PTPTransferLog, USBTransferLog }
