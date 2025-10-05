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

type Log<Ops extends readonly OperationDefinition[]> = PTPOperationLog<Ops> | USBTransferLog

// Before adding to logger (no id/timestamp yet)
type NewLog<Ops extends readonly OperationDefinition[]> = Omit<Log<Ops>, 'id' | 'timestamp'>

export class Logger<Ops extends readonly OperationDefinition[]> {
    private logs: Map<string, Log<Ops>[]> = new Map() // key: "sessionId:transactionId"
    private orderedTransactions: Array<{
        key: string // "sessionId:transactionId"
        timestamp: number // earliest timestamp in this transaction
    }> = []
    private config: LoggerConfig
    private nextId: number = 1
    private changeListeners: Array<() => void> = []
    private notifyTimeout: NodeJS.Timeout | null = null

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...defaultLoggerConfig, ...config }
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
    addLog(log: NewLog<Ops>): number {
        const id = this.nextId++
        const timestamp = Date.now()
        const fullLog = { ...log, id, timestamp } as Log<Ops>

        const key = this.getKey(log.sessionId, log.transactionId)
        const existing = this.logs.get(key)

        if (!existing) {
            // New transaction
            this.logs.set(key, [fullLog])
            this.orderedTransactions.push({ key, timestamp })
        } else {
            // Add to existing transaction
            existing.push(fullLog)
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

    clear(): void {
        this.logs.clear()
        this.orderedTransactions = []
    }

    private trimIfNeeded(): void {
        if (!this.config.maxLogs || this.orderedTransactions.length <= this.config.maxLogs) return

        const toDelete = this.orderedTransactions.slice(0, this.orderedTransactions.length - this.config.maxLogs)
        toDelete.forEach(({ key }) => this.logs.delete(key))
        this.orderedTransactions = this.orderedTransactions.slice(-this.config.maxLogs)
    }
}

export type { LogLevel, BaseLog, PTPOperationLog, USBTransferLog, Log, NewLog }
