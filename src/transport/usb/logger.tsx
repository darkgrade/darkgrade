import React, { useState, useCallback, useImperativeHandle, forwardRef } from 'react'
import { render, Box, Text } from 'ink'
import Spinner from 'ink-spinner'

// Base log entry interface
type BaseLogEntry = {
    status: 'pending' | 'succeeded' | 'failed'
    message: string
    source?: string
}

type USBTransferEntry = BaseLogEntry & {
    type: 'usb_transfer'
    direction: 'send' | 'receive'
    bytes: number
    endpoint: 'bulkIn' | 'bulkOut' | 'interrupt'
    endpointAddress: string
}

type PTPSessionEntry = BaseLogEntry & {
    type: 'ptp_session'
    sessionId?: number
}

type ErrorEntry = BaseLogEntry & {
    type: 'error'
    details?: string[]
}

type InfoEntry = BaseLogEntry & {
    type: 'info'
}

type WarningEntry = BaseLogEntry & {
    type: 'warning'
}

type PTPOperationEntry = BaseLogEntry & {
    type: 'ptp_operation'
    operation: string
    parameters: Record<string, any>
}

type PTPPropertyGetEntry = BaseLogEntry & {
    type: 'ptp_property_get'
    property: string
}

type PTPPropertySetEntry = BaseLogEntry & {
    type: 'ptp_property_set'
    property: string
    value: any
}

// before instantiated in the logger it will not have id and timestamp
type NewLogEntry =
    | USBTransferEntry
    | PTPSessionEntry
    | ErrorEntry
    | InfoEntry
    | WarningEntry
    | PTPOperationEntry
    | PTPPropertyGetEntry
    | PTPPropertySetEntry
type LogEntry = NewLogEntry & { id: number; timestamp: number }

export interface LoggerInterface {
    addLog(entry: NewLogEntry): number
    updateEntry(id: number, updates: Partial<LogEntry>): number
}

export const getRandomId = (): number => {
    return Date.now() + Math.round(Math.random() * 1000)
}

const LoggerDisplay = forwardRef<LoggerInterface, { maxEntries?: number }>(({ maxEntries = 100 }, ref) => {
    const [logs, setLogs] = useState<{ [key: string]: LogEntry }>({})
    const [nextId, setNextId] = useState<number>(getRandomId())

    const addLog = useCallback(
        (entry: Omit<LogEntry, 'id' | 'timestamp'>): number => {
            const newId = getRandomId()
            setNextId(newId)
            const newEntry = { ...entry, id: newId, timestamp: Date.now() } as LogEntry
            setLogs(prevLogs => ({ ...prevLogs, [newId]: newEntry }))
            return newId
        },
        [nextId]
    )

    const updateEntry = useCallback((id: number, updates: Partial<LogEntry>): number => {
        setLogs(prevLogs => ({
            ...prevLogs,
            [id]: { ...prevLogs[id], ...updates } as LogEntry,
        }))
        return id
    }, [])

    useImperativeHandle(
        ref,
        () => ({
            addLog,
            updateEntry,
        }),
        [addLog, updateEntry]
    )

    const formatTime = (timestamp: number) => {
        const date = new Date(timestamp)
        return date.toLocaleTimeString('en-US', {
            hour12: true,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
    }

    const getTypeColor = (entry: LogEntry) => {
        switch (entry.status) {
            case 'succeeded':
                return 'green'
            case 'failed':
                return 'red'
            default:
                return 'blue'
        }
    }

    const getTypeIcon = (entry: LogEntry) => {
        // Show spinner for pending status
        if (entry.status === 'pending') {
            return <Spinner type="dots" />
        }

        switch (entry.type) {
            case 'ptp_session':
                return '⃕$'
            case 'ptp_operation':
                return entry.status === 'succeeded' ? '⚡' : '✗'
            case 'ptp_property_get':
                return entry.status === 'succeeded' ? '←' : '✗'
            case 'ptp_property_set':
                return entry.status === 'succeeded' ? '→' : '✗'
            case 'usb_transfer':
                if (entry.status === 'failed') return '✗'
                return entry.direction === 'send' ? '↗' : '↙'
            case 'error':
                return '✗'
            case 'info':
                return 'ℹ'
            default:
                return '•'
        }
    }

    const getSourcePrefix = (entry: LogEntry) => {
        switch (entry.type) {
            case 'usb_transfer':
                return 'USB'
            case 'ptp_operation':
            case 'ptp_property_get':
            case 'ptp_property_set':
            case 'ptp_session':
                return 'PTP'
            case 'error':
            case 'info':
            default:
                if (entry.source) {
                    return entry.source
                }
                return 'SYS'
        }
    }

    const formatMessage = (entry: LogEntry) => {
        switch (entry.type) {
            case 'usb_transfer':
                return `${entry.message} using ${entry.endpoint} endpoint ${entry.endpointAddress} (${entry.bytes} bytes) `
            case 'ptp_operation':
                const params = Object.entries(entry.parameters)
                    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
                    .join(', ')
                return `${entry.message} ${entry.operation}(${params})`
            case 'ptp_property_get':
                return `${entry.message} ${entry.property}`
            case 'ptp_property_set':
                return `${entry.message} ${entry.property} = ${JSON.stringify(entry.value)}`
            case 'ptp_session':
            case 'error':
            case 'info':
            default:
                return entry.message
        }
    }

    return (
        <Box flexDirection="column">
            {Object.values(logs).map(entry => (
                <Box key={entry.id} flexDirection="row" gap={1}>
                    <Box display="flex" flexDirection="row" gap={2}>
                        <Text dimColor>{formatTime(entry.timestamp)}</Text>
                        <Text dimColor color={getSourcePrefix(entry) === 'USB' ? 'yellow' : 'magenta'}>
                            [{getSourcePrefix(entry)}]
                        </Text>
                        <Text color={getTypeColor(entry)} bold>
                            {getTypeIcon(entry)}
                        </Text>
                    </Box>
                    <Box display="flex" flexDirection="column">
                        <Text color={getTypeColor(entry)}>{formatMessage(entry)}</Text>
                        {/* {entry.type === 'ptp_operation' && entry.operation.parameters && (
                            <Box display="flex" flexDirection="column" marginLeft={4}>
                                <Text color="cyan">Parameters:</Text>
                                <Box display="flex" flexDirection="column" marginLeft={4}>
                                    {entry.operation.parameters.map(param => (
                                        <Text key={param.toString()} color="cyan">
                                            {`- 0x${param.toString(16)} (${param})`}
                                        </Text>
                                    ))}
                                </Box>
                                <Text color="cyan">Response:</Text>
                                <Box display="flex" flexDirection="column" marginLeft={4}>
                                    {entry?.response?.name}
                                    {entry?.response?.description}
                                </Box>
                            </Box>
                        )} */}
                    </Box>
                </Box>
            ))}
        </Box>
    )
})

class Logger implements LoggerInterface {
    private loggerRef = React.createRef<LoggerInterface>()

    constructor() {
        render(<LoggerDisplay ref={this.loggerRef} />)
    }

    addLog(entry: NewLogEntry): number {
        if (this.loggerRef.current) {
            return this.loggerRef.current.addLog(entry)
        }
        return -1
    }

    updateEntry(id: number, updates: Partial<LogEntry>): number {
        if (this.loggerRef.current) {
            return this.loggerRef.current.updateEntry(id, updates)
        }
        return -1 // Return invalid ID if ref not available
    }
}

export { Logger }
export type { LogEntry }
