/**
 * BrowserLogger - Simple console-based logger for browser environments
 * Implements the Logger interface without using Ink (which requires Node/terminal)
 */

import type { LoggerConfig } from '@darkgrade/link'
import { defaultLoggerConfig } from '@darkgrade/link'

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

type Log = PTPOperationLog | USBTransferLog | PTPTransferLog | ConsoleLog

type NewLog =
    | Omit<PTPOperationLog, 'id' | 'timestamp'>
    | Omit<USBTransferLog, 'id' | 'timestamp'>
    | Omit<PTPTransferLog, 'id' | 'timestamp'>
    | Omit<ConsoleLog, 'id' | 'timestamp'>

export class BrowserLogger {
    private logs: Log[] = []
    private config: LoggerConfig
    private nextId: number = 1
    private activeTransfers: Map<number, number> = new Map()

    constructor(config: Partial<LoggerConfig> = {}) {
        this.config = { ...defaultLoggerConfig, ...config }
    }

    addLog(log: NewLog): number {
        const id = this.nextId++
        const fullLog: Log = {
            ...log,
            id,
            timestamp: Date.now(),
        } as Log

        this.logs.push(fullLog)

        // Log to console for visibility
        if (fullLog.type === 'ptp_operation' || fullLog.type === 'ptp_transfer') {
            console.log(`[${fullLog.type}] ${fullLog.requestPhase.operationName}`)
        }

        return id
    }

    updateLog(id: number, updates: Partial<Log>): void {
        const log = this.logs.find(l => l.id === id)
        if (log) {
            Object.assign(log, updates)
        }
    }

    getLogs(): Log[] {
        return this.logs
    }

    getLogById(id: number): Log | undefined {
        return this.logs.find(l => l.id === id)
    }

    clearLogs(): void {
        this.logs = []
        this.activeTransfers.clear()
    }

    registerTransfer(objectHandle: number, logId: number): void {
        this.activeTransfers.set(objectHandle, logId)
    }

    unregisterTransfer(objectHandle: number): void {
        this.activeTransfers.delete(objectHandle)
    }

    getActiveTransfer(objectHandle: number): number | undefined {
        return this.activeTransfers.get(objectHandle)
    }
}
