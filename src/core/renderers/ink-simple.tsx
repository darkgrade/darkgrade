import React from 'react'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import { OperationDefinition } from '../../ptp/types/operation'
import { Logger, Log, PTPOperationLog, USBTransferLog } from '../logger'
import { responseDefinitions } from '../../ptp/definitions/response-definitions'

interface InkSimpleLoggerProps<Ops extends readonly OperationDefinition[]> {
    logger: Logger<Ops>
}

interface TransactionGroup<Ops extends readonly OperationDefinition[]> {
    key: string
    sessionId: number
    transactionId: number
    ptpLog?: PTPOperationLog<Ops>
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
        const key = `${log.sessionId}:${log.transactionId}`

        if (!grouped.has(key)) {
            grouped.set(key, {
                key,
                sessionId: log.sessionId,
                transactionId: log.transactionId,
                usbLogs: [],
                timestamp: log.timestamp,
            })
        }

        const group = grouped.get(key)!
        if (log.type === 'ptp_operation') {
            group.ptpLog = log as PTPOperationLog<Ops>
        } else if (log.type === 'usb_transfer') {
            group.usbLogs.push(log as USBTransferLog)
        }
    }

    const transactions = Array.from(grouped.values()).filter(t => t.ptpLog)

    const config = logger.getConfig()

    return (
        <Box flexDirection="column">
            {transactions.map(transaction => {
                const ptpLog = transaction.ptpLog!
                const operationName = ptpLog.requestPhase.operationName

                // Determine status
                const hasError = ptpLog.responsePhase && ptpLog.responsePhase.code !== 0x2001
                const isSuccess = ptpLog.responsePhase && ptpLog.responsePhase.code === 0x2001
                const isRunning = !ptpLog.responsePhase

                // Calculate timing
                const startTime = ptpLog.requestPhase.timestamp
                const endTime = ptpLog.responsePhase?.timestamp || Date.now()
                const duration = endTime - startTime

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
                    <Box key={transaction.key} flexDirection="column">
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
                        <Text dimColor>  ├─ Session 0x{transaction.sessionId.toString(16)}, transaction {transaction.transactionId}</Text>
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
                                    ? `0x${value.toString(16)}`
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
                            transaction.usbLogs
                                .filter(u => u.phase === 'request')
                                .map((usbLog) => {
                                    const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                    return (
                                        <Text key={usbLog.id}>
                                            <Text dimColor>{ptpLog.dataPhase || ptpLog.responsePhase ? '  │' : '  '}</Text>    Transferred {usbLog.bytes} bytes via USB {direction} {usbLog.endpoint}{' '}
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
                                    <Text color="magenta" bold>{ptpLog.dataPhase.timestamp - ptpLog.requestPhase.timestamp}ms</Text>
                                </Text>
                                {config.showDecodedData &&
                                    ptpLog.dataPhase.decodedData !== undefined &&
                                    ptpLog.dataPhase.decodedData !== null &&
                                    JSON.stringify(ptpLog.dataPhase.decodedData, null, 2)
                                        .split('\n')
                                        .slice(0, 20)
                                        .map((line, idx) => (
                                            <Text key={idx}>
                                                <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    {line}
                                            </Text>
                                        ))}
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
                                {!config.collapseUSB &&
                                    transaction.usbLogs
                                        .filter(u => u.phase === 'data')
                                        .map((usbLog) => {
                                            const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                            return (
                                                <Text key={usbLog.id}>
                                                    <Text dimColor>{ptpLog.responsePhase ? '  │' : '  '}</Text>    Transferred {usbLog.bytes} bytes via USB {direction} {usbLog.endpoint}{' '}
                                                    {usbLog.endpointAddress}
                                                </Text>
                                            )
                                        })}
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
                                    <Text color="magenta" bold>{ptpLog.responsePhase.timestamp - (ptpLog.dataPhase?.timestamp || ptpLog.requestPhase.timestamp)}ms</Text>
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
                                    transaction.usbLogs
                                        .filter(u => u.phase === 'response')
                                        .map((usbLog) => {
                                            const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                            return (
                                                <Text key={usbLog.id}>
                                                    {'       '}Transferred {usbLog.bytes} bytes via USB {direction} {usbLog.endpoint}{' '}
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

                        {/* Spacing between operations */}
                        <Text>{'\n'}</Text>
                        <Text>{'\n'}</Text>
                    </Box>
                )
            })}
        </Box>
    )
}
