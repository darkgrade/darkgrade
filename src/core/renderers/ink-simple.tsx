import React from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { OperationDefinition } from '../../ptp/types/operation'
import { Logger, Log, PTPOperationLog, USBTransferLog, PTPTransferLog, ConsoleLog } from '../logger'
import { responseDefinitions } from '../../ptp/definitions/response-definitions'
import { formatJSON } from './formatters/compact-formatter'
import { formatBytes } from './formatters/bytes-formatter'

interface InkSimpleLoggerProps<Ops extends readonly OperationDefinition[]> {
    logger: Logger<Ops>
}

interface TransactionGroup<Ops extends readonly OperationDefinition[]> {
    key: string
    sessionId?: number
    transactionId?: number
    ptpLog?: PTPOperationLog<Ops> | PTPTransferLog<Ops>
    consoleLog?: ConsoleLog
    usbLogs: USBTransferLog[]
    timestamp: number
}

export function InkSimpleLogger<Ops extends readonly OperationDefinition[]>({
    logger,
}: InkSimpleLoggerProps<Ops>) {
    // Force re-render when logger changes
    const [updateCount, forceUpdate] = React.useReducer(x => x + 1, 0)

    React.useEffect(() => {
        const listener = () => forceUpdate()
        logger.onChange(listener)
    }, [logger])

    // Group logs by transaction (re-compute on every update)
    const allLogs = logger.getLogs()
    const grouped = new Map<string, TransactionGroup<Ops>>()

    for (const log of allLogs) {
        if (log.type === 'console') {
            // Console logs get their own group
            const consoleLog = log as ConsoleLog
            const key = `console:${consoleLog.id}`
            grouped.set(key, {
                key,
                consoleLog,
                usbLogs: [],
                timestamp: log.timestamp,
            })
        } else {
            const ptpLog = log as PTPOperationLog<Ops> | USBTransferLog | PTPTransferLog<Ops>
            const key = `${ptpLog.sessionId}:${ptpLog.transactionId}`

            if (!grouped.has(key)) {
                grouped.set(key, {
                    key,
                    sessionId: ptpLog.sessionId,
                    transactionId: ptpLog.transactionId,
                    usbLogs: [],
                    timestamp: log.timestamp,
                })
            }

            const group = grouped.get(key)!
            if (log.type === 'ptp_operation' || log.type === 'ptp_transfer') {
                group.ptpLog = log as PTPOperationLog<Ops> | PTPTransferLog<Ops>
            } else if (log.type === 'usb_transfer') {
                group.usbLogs.push(log as USBTransferLog)
            }
        }
    }

    // Sort all groups by timestamp to interleave console logs and operations
    const allGroups = Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp)

    const config = logger.getConfig()

    return (
        <Box flexDirection="column" rowGap={1}>
            {allGroups.map(group => {
                // Handle console logs
                if (group.consoleLog) {
                    const consoleLog = group.consoleLog
                    const colorMap = {
                        log: 'cyan',
                        info: 'cyan',
                        warn: 'yellow',
                        error: 'red',
                    } as const
                    const color = colorMap[consoleLog.consoleLevel]
                    const levelLabel = consoleLog.consoleLevel === 'log' ? 'Debug' : consoleLog.consoleLevel.charAt(0).toUpperCase() + consoleLog.consoleLevel.slice(1)
                    const formatted = consoleLog.args
                        .map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
                        .join(' ')

                    // Format timestamp
                    const date = new Date(consoleLog.timestamp)
                    const hours24 = date.getHours()
                    const hours = hours24 % 12 || 12
                    const minutes = date.getMinutes().toString().padStart(2, '0')
                    const seconds = date.getSeconds().toString().padStart(2, '0')
                    const millis = date.getMilliseconds().toString().padStart(3, '0')
                    const ampm = hours24 >= 12 ? 'PM' : 'AM'
                    const timestamp = `${hours}:${minutes}:${seconds}.${millis} ${ampm}`

                    return (
                        <Box key={group.key} flexDirection="column">
                            <Text>
                                <Text bold>{timestamp} [</Text>
                                <Text color={color} bold>{levelLabel}</Text>
                                <Text bold>] </Text>
                                <Text>{formatted}</Text>
                            </Text>
                        </Box>
                    )
                }

                // Handle PTP operations
                if (!group.ptpLog) return null

                const ptpLog = group.ptpLog
                const operationName = ptpLog.requestPhase.operationName

                // Determine status
                const hasError = ptpLog.responsePhase && ptpLog.responsePhase.code !== 0x2001
                const isSuccess = ptpLog.responsePhase && ptpLog.responsePhase.code === 0x2001
                const isRunning = !ptpLog.responsePhase

                // Calculate timing
                const startTime = ptpLog.requestPhase.timestamp
                const endTime = ptpLog.responsePhase?.timestamp || Date.now()

                // For transfer logs, calculate aggregate timing across all chunks
                let duration: number
                let dataPhaseTime: number
                let responsePhaseTime: number
                if (ptpLog.type === 'ptp_transfer') {
                    const transferLog = ptpLog as PTPTransferLog<Ops>
                    // First chunk starts at requestPhase timestamp
                    const firstChunkTime = transferLog.chunks[0]?.timestamp || startTime
                    const lastChunkTime = transferLog.chunks[transferLog.chunks.length - 1]?.timestamp || Date.now()
                    dataPhaseTime = lastChunkTime - firstChunkTime
                    responsePhaseTime = ptpLog.responsePhase ? ptpLog.responsePhase.timestamp - lastChunkTime : 0
                    duration = endTime - startTime
                } else {
                    duration = endTime - startTime
                    dataPhaseTime = ptpLog.dataPhase ? ptpLog.dataPhase.timestamp - ptpLog.requestPhase.timestamp : 0
                    responsePhaseTime = ptpLog.responsePhase ? ptpLog.responsePhase.timestamp - (ptpLog.dataPhase?.timestamp || ptpLog.requestPhase.timestamp) : 0
                }

                // Format timestamp
                const date = new Date(ptpLog.timestamp)
                const hours24 = date.getHours()
                const hours = hours24 % 12 || 12
                const minutes = date.getMinutes().toString().padStart(2, '0')
                const seconds = date.getSeconds().toString().padStart(2, '0')
                const millis = date.getMilliseconds().toString().padStart(3, '0')
                const ampm = hours24 >= 12 ? 'PM' : 'AM'
                const timestamp = `${hours}:${minutes}:${seconds}.${millis} ${ampm}`

                const statusSymbol = hasError ? '✗' : isSuccess ? '✓' : '⋯'
                const statusColor = hasError ? 'red' : isSuccess ? 'green' : 'yellow'

                return (
                    <Box key={group.key} flexDirection="column">
                        {/* Header */}
                        <Box>
                            <Text bold>{timestamp} </Text>
                            <Text color="blue" bold>{operationName} </Text>
                            <Text bold>{isRunning ? 'running' : 'ran for'} </Text>
                            {isRunning ? (
                                <Text color="magenta" bold><Spinner type="dots" /> </Text>
                            ) : (
                                <>
                                    <Text color="magenta" bold>{duration}ms </Text>
                                    <Text color={statusColor} bold>{statusSymbol}</Text>
                                </>
                            )}
                        </Box>
                        <Text dimColor>  ├─ Session 0x{group.sessionId!.toString(16)}, transaction {group.transactionId}</Text>
                        <Text dimColor>  │</Text>

                        {/* Request Phase */}
                        <Text>
                            <Text dimColor>  {ptpLog.dataPhase || ptpLog.responsePhase ? '├─' : '└─'} </Text>
                            <Text>Sent </Text>
                            <Text color="blue" bold>request</Text>
                            <Text> in </Text>
                            <Text color="magenta" bold>0ms</Text>
                        </Text>
                        {Object.keys(ptpLog.requestPhase.decodedParams).length === 0 ? (
                            <Text><Text dimColor>  │</Text>    (no parameters)</Text>
                        ) : (
                            Object.entries(ptpLog.requestPhase.decodedParams).map(([key, value]) => {
                                // Format numeric values as hex
                                const formattedValue = typeof value === 'number'
                                    ? `0x${(value as number).toString(16)}`
                                    : JSON.stringify(value)
                                return (
                                    <Text key={key}>
                                        <Text dimColor>{ptpLog.dataPhase || ptpLog.responsePhase ? '  │' : '  '}</Text>    {key} set to {formattedValue}
                                    </Text>
                                )
                            })
                        )}
                        {config.showEncodedData &&
                            ptpLog.requestPhase.encodedParams?.map((encoded, idx) => {
                                const hex = Array.from(encoded.slice(0, 16))
                                    .map(b => b.toString(16).padStart(2, '0'))
                                    .join(' ')
                                return (
                                    <Text key={idx}>
                                        <Text dimColor>{ptpLog.dataPhase || ptpLog.responsePhase ? '  │' : '  '}</Text>    Bytes encoded as [{hex}
                                        {encoded.length > 16 ? '...' : ''}]
                                    </Text>
                                )
                            })}
                        {/* USB transfers for request phase */}
                        {!config.collapseUSB &&
                            group.usbLogs
                                .filter(u => u.phase === 'request')
                                .map((usbLog) => {
                                    const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                    return (
                                        <Text key={usbLog.id}>
                                            <Text dimColor>{ptpLog.dataPhase || ptpLog.responsePhase ? '  │' : '  '}</Text>    Transferred {formatBytes(usbLog.bytes)} via USB {direction} {usbLog.endpoint}{' '}
                                            {usbLog.endpointAddress}
                                        </Text>
                                    )
                                })}

                        {/* Data Phase */}
                        {ptpLog.dataPhase ? (
                            <>
                                <Text dimColor>  │</Text>
                                <Text>
                                    <Text dimColor>  {ptpLog.responsePhase ? '├─' : '└─'} </Text>
                                    <Text>{ptpLog.dataPhase.direction === 'in' ? 'Sent' : 'Received'} </Text>
                                    <Text color="blue" bold>data</Text>
                                    <Text> in </Text>
                                    <Text color="magenta" bold>{dataPhaseTime}ms</Text>
                                </Text>
                                {/* Progress bar for transfer logs */}
                                {ptpLog.type === 'ptp_transfer' && (() => {
                                    const transferLog = ptpLog as PTPTransferLog<Ops>
                                    const percent = transferLog.totalBytes > 0
                                        ? (transferLog.transferredBytes / transferLog.totalBytes) * 100
                                        : 0
                                    const barLength = 30
                                    const filledLength = Math.round((percent / 100) * barLength)
                                    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)

                                    // Calculate average chunk size
                                    const avgChunkSize = transferLog.chunks.length > 0
                                        ? transferLog.transferredBytes / transferLog.chunks.length
                                        : 0

                                    // Calculate speed from last chunk
                                    let speedText = ''
                                    if (transferLog.chunks.length >= 2) {
                                        const lastChunk = transferLog.chunks[transferLog.chunks.length - 1]
                                        const prevChunk = transferLog.chunks[transferLog.chunks.length - 2]
                                        const timeDiff = (lastChunk.timestamp - prevChunk.timestamp) / 1000 // seconds
                                        if (timeDiff > 0) {
                                            const bytesPerSecond = lastChunk.bytes / timeDiff
                                            speedText = `${formatBytes(bytesPerSecond, 1)}/s`
                                        }
                                    }

                                    return (
                                        <>
                                            <Text>
                                                <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    <Text color="blue">{bar}</Text>
                                                <Text> {percent.toFixed(1)}%</Text>
                                            </Text>
                                            <Text>
                                                <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    <Text>{speedText} ({formatBytes(transferLog.totalBytes)} total, {transferLog.chunks.length} chunks @ {formatBytes(avgChunkSize, 0)} each)</Text>
                                            </Text>
                                        </>
                                    )
                                })()}
                                {config.showDecodedData &&
                                    ptpLog.dataPhase.decodedData !== undefined &&
                                    ptpLog.dataPhase.decodedData !== null &&
                                    (() => {
                                        const prefix = ptpLog.responsePhase ? '  │' : '  '
                                        const formattedLines = formatJSON(ptpLog.dataPhase.decodedData, 0)

                                        return formattedLines.map((line, idx) => (
                                            <Text key={idx}>
                                                <Text dimColor>{prefix}</Text>    {line}
                                            </Text>
                                        ))
                                    })()}
                                {config.showEncodedData && ptpLog.dataPhase.encodedData && (
                                    <Text>
                                        <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    Bytes encoded as [
                                        {Array.from(ptpLog.dataPhase.encodedData.slice(0, 16))
                                            .map(b => b.toString(16).padStart(2, '0'))
                                            .join(' ')}
                                        {ptpLog.dataPhase.encodedData.length > 16 ? '...' : ''}]
                                    </Text>
                                )}
                                {/* USB transfers for data phase */}
                                {!config.collapseUSB && (() => {
                                    const dataUsbLogs = group.usbLogs.filter(u => u.phase === 'data')

                                    // For transfer logs, show aggregate USB stats across all chunks
                                    if (ptpLog.type === 'ptp_transfer' && dataUsbLogs.length > 0) {
                                        const transferLog = ptpLog as PTPTransferLog<Ops>
                                        const totalBytes = transferLog.transferredBytes
                                        const direction = dataUsbLogs[0].direction === 'send' ? 'to' : 'from'
                                        const endpoint = dataUsbLogs[0].endpoint
                                        const endpointAddress = dataUsbLogs[0].endpointAddress

                                        return (
                                            <Text key="aggregate-usb">
                                                <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    Transferred {formatBytes(totalBytes)} via USB {direction} {endpoint}{' '}
                                                {endpointAddress}
                                            </Text>
                                        )
                                    }

                                    // For regular operations, show individual USB transfers
                                    return dataUsbLogs.map((usbLog) => {
                                        const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                        return (
                                            <Text key={usbLog.id}>
                                                <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    Transferred {formatBytes(usbLog.bytes)} via USB {direction} {usbLog.endpoint}{' '}
                                                {usbLog.endpointAddress}
                                            </Text>
                                        )
                                    })
                                })()}
                            </>
                        ) : !ptpLog.responsePhase ? (
                            <>
                                <Text dimColor>  │</Text>
                                <Text>
                                    <Text dimColor>  └─ </Text>
                                    <Text>Receiving </Text>
                                    <Text color="blue" bold>data</Text>
                                    <Text> </Text>
                                    <Text color="magenta" bold><Spinner type="dots" /></Text>
                                </Text>
                            </>
                        ) : null}

                        {/* Response Phase */}
                        {ptpLog.responsePhase ? (
                            <>
                                <Text dimColor>  │</Text>
                                <Text>
                                    <Text dimColor>  └─ </Text>
                                    <Text>Received </Text>
                                    <Text color={hasError ? 'red' : 'green'} bold>response</Text>
                                    <Text> in </Text>
                                    <Text color="magenta" bold>{responsePhaseTime}ms</Text>
                                </Text>
                                <Text>
                                    {'       '}Response code: {hasError ? 'error' : 'ok'} (0x{ptpLog.responsePhase.code.toString(16)})
                                    {(() => {
                                        const responseDef = responseDefinitions.find(r => r.code === ptpLog.responsePhase!.code)
                                        return responseDef ? ` - ${responseDef.description}` : ''
                                    })()}
                                </Text>
                                {/* USB transfers for response phase */}
                                {!config.collapseUSB &&
                                    group.usbLogs
                                        .filter(u => u.phase === 'response')
                                        .map((usbLog) => {
                                            const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                            return (
                                                <Text key={usbLog.id}>
                                                    {'       '}Transferred {formatBytes(usbLog.bytes)} via USB {direction} {usbLog.endpoint}{' '}
                                                    {usbLog.endpointAddress}
                                                </Text>
                                            )
                                        })}
                            </>
                        ) : (
                            <>
                                <Text dimColor>  │</Text>
                                <Text>
                                    <Text dimColor>  └─ </Text>
                                    <Text>Receiving </Text>
                                    <Text color="blue" bold>response</Text>
                                    <Text> </Text>
                                    <Text color="magenta" bold><Spinner type="dots" /></Text>
                                </Text>
                            </>
                        )}
                    </Box>
                )
            })}
        </Box>
    )
}
