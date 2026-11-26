import { LoggerConfig, defaultLoggerConfig } from './logger-config'

/** What the logger reads from a driver's registry: its response names (core imports no vendor table). */
interface ResponseNames {
    responses: Record<string, { code: number; name: string; description: string }>
}

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
    private orderedTransactions: Array<{ key: string; timestamp: number }> = []
    private config: LoggerConfig
    private nextId: number = 1
    private changeListeners: Array<() => void> = []
    private notifyTimeout: NodeJS.Timeout | null = null
    private activeTransfers: Map<number, number> = new Map()
    /** Which transaction each log id belongs to, so updates find their log without a scan. */
    private logKeys: Map<number, string> = new Map()
    private registry: ResponseNames | null = null
    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...defaultLoggerConfig, ...config }

        if (typeof window === 'undefined' && typeof process !== 'undefined') {
            if (this.config.captureConsole) this.captureConsole()
            if (this.config.renderInTerminal) this.setupInkRenderer()
        }
    }

    private captureConsole() {
        const createWrapper =
            (consoleLevel: ConsoleLog['consoleLevel']) =>
            (...args: ConsoleLog['args']) =>
                this.addLog({ type: 'console', level: 'info', consoleLevel, args })

        console.log = createWrapper('log')
        console.error = createWrapper('error')
        console.info = createWrapper('info')
        console.warn = createWrapper('warn')
    }

    private async setupInkRenderer() {
        const react = await import('react')
        const ink = await import('ink')
        const renderer = await import('./renderers/ink')

        ink.render(react.createElement(renderer.InkLogger, { logger: this }), { patchConsole: false })
    }

    onChange(listener: () => void) {
        this.changeListeners.push(listener)
        return () => {
            const index = this.changeListeners.indexOf(listener)
            if (index >= 0) this.changeListeners.splice(index, 1)
        }
    }

    private notifyChange() {
        if (this.notifyTimeout) clearTimeout(this.notifyTimeout)
        this.notifyTimeout = setTimeout(() => {
            for (const listener of [...this.changeListeners]) listener()
            this.notifyTimeout = null
        }, 0)
    }

    private getKey(sessionId: number, transactionId: number): string {
        return `${sessionId}:${transactionId}`
    }

    addLog(log: NewLog): number {
        const id = this.nextId++
        const timestamp = Date.now()
        const key = this.keyForNewLog(log, id)
        this.logKeys.set(id, key)
        const existing = this.logs.get(key)
        const entry: Log = { ...log, id, timestamp }
        if (existing) existing.push(entry)
        else {
            this.logs.set(key, [entry])
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

    getConfig(): LoggerConfig {
        return this.config
    }

    /** The driver's registry, read only for its response names. */
    setRegistry(registry: ResponseNames): void {
        this.registry = registry
    }

    getResponseRegistry(): ResponseNames['responses'] {
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

    completeTransfer(objectHandle: number, code = 0x2001): void {
        const logId = this.activeTransfers.get(objectHandle)
        if (logId !== undefined) {
            this.updateLog(logId, {
                level: code === 0x2001 ? 'info' : 'error',
                responsePhase: { timestamp: Date.now(), code },
            })
        }
        this.activeTransfers.delete(objectHandle)
        this.trimIfNeeded()
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
        const key = `transfer:${sessionId}:${objectHandle}`
        this.logKeys.set(transferLog.id, key)
        this.logs.set(key, [transferLog])
        this.orderedTransactions.push({ key, timestamp: transferLog.timestamp })
        this.activeTransfers.set(objectHandle, transferLog.id)
        this.notifyChange()
        return transferLog.id
    }

    updateTransferProgress(objectHandle: number, chunkBytes: number, chunkTransactionId: number): void {
        const logId = this.activeTransfers.get(objectHandle)
        if (logId === undefined) return

        const log = this.getLogById(logId)
        if (!log || log.type !== 'ptp_transfer') return

        const chunk = {
            transactionId: chunkTransactionId,
            timestamp: Date.now(),
            offset: log.transferredBytes,
            bytes: chunkBytes,
        }
        const transferredBytes = log.transferredBytes + chunkBytes
        this.updateLog(logId, {
            chunks: [...log.chunks, chunk],
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
