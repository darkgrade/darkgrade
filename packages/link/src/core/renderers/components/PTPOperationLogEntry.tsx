import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'
import { OK } from '../../../ptp/definitions/response-definitions'
import { ConsoleLog, PTPEventLog, PTPOperationLog, PTPTransferLog, USBTransferLog } from '../../logger'
import { formatBytes } from '../formatters/bytes-formatter'
import { formatJSON } from '../formatters/compact-formatter'
import { safeStringify } from '../formatters/safe-stringify'
import { formatTimestamp } from '../formatters/timestamp-formatter'

export interface TransactionGroup {
    key: string
    sessionId?: number
    transactionId?: number
    ptpLog?: PTPOperationLog | PTPTransferLog
    consoleLog?: ConsoleLog
    eventLog?: PTPEventLog
    usbLogs: USBTransferLog[]
    timestamp: number
}

interface PTPOperationLogEntryProps {
    group: TransactionGroup
    expanded: boolean
    responseRegistry: Record<string, { code: number; name: string; description: string }>
}

export function PTPOperationLogEntry({ group, expanded, responseRegistry }: PTPOperationLogEntryProps) {
    const responseDefinitions = React.useMemo(() => Object.values(responseRegistry), [responseRegistry])
    const ptpLog = group.ptpLog!
    const operationName = ptpLog.requestPhase.operationName

    const hasError = ptpLog.responsePhase && ptpLog.responsePhase.code !== OK.code
    const isSuccess = ptpLog.responsePhase && ptpLog.responsePhase.code === OK.code
    const isRunning = !ptpLog.responsePhase

    const startTime = ptpLog.requestPhase.timestamp
    const endTime = ptpLog.responsePhase?.timestamp || Date.now()

    let duration: number
    let dataPhaseTime: number
    let responsePhaseTime: number
    let transferChunks: Array<{ transactionId: number; timestamp: number; offset: number; bytes: number }> = []
    let totalBytes = 0
    let transferredBytes = 0

    if (ptpLog.type === 'ptp_transfer') {
        transferChunks = ptpLog.chunks
        totalBytes = ptpLog.totalBytes
        transferredBytes = ptpLog.transferredBytes

        const firstChunkTime = transferChunks[0]?.timestamp || startTime
        const lastChunkTime = transferChunks[transferChunks.length - 1]?.timestamp || Date.now()
        dataPhaseTime = lastChunkTime - firstChunkTime
        responsePhaseTime = ptpLog.responsePhase ? ptpLog.responsePhase.timestamp - lastChunkTime : 0
        duration = endTime - startTime
    } else {
        duration = endTime - startTime
        dataPhaseTime = ptpLog.dataPhase ? ptpLog.dataPhase.timestamp - ptpLog.requestPhase.timestamp : 0
        responsePhaseTime = ptpLog.responsePhase
            ? ptpLog.responsePhase.timestamp - (ptpLog.dataPhase?.timestamp || ptpLog.requestPhase.timestamp)
            : 0
    }

    const timestamp = formatTimestamp(group.timestamp)
    const statusSymbol = hasError ? '✗' : isSuccess ? '✓' : '⋯'
    const statusColor = hasError ? 'red' : isSuccess ? 'green' : 'yellow'

    return (
        <Box
            flexDirection="column"
            width={100}
            paddingX={2}
            paddingY={1}
            borderStyle="round"
            borderLeft
            borderColor="blue"
        >
            {/* Header */}
            <Box>
                <Text bold>{timestamp} </Text>
                <Text color="blue" bold>
                    {operationName}{' '}
                </Text>
                <Text bold>{isRunning ? 'running' : 'ran for'} </Text>
                {isRunning ? (
                    <Text color="magenta" bold>
                        <Spinner type="dots" />{' '}
                    </Text>
                ) : (
                    <>
                        <Text color="magenta" bold>
                            {duration}ms{' '}
                        </Text>
                        <Text color={statusColor} bold>
                            {statusSymbol}
                        </Text>
                    </>
                )}
            </Box>

            {expanded && (
                <>
                    {/* Session info */}
                    <Box marginTop={1}>
                        <Text dimColor>
                            Session 0x{group.sessionId!.toString(16)}, transaction {group.transactionId}
                        </Text>
                    </Box>

                    {/* Request Phase */}
                    <Box flexDirection="column" marginTop={1}>
                        <Box>
                            <Text>Sent </Text>
                            <Text color="blue" bold>
                                request
                            </Text>
                            <Text> in </Text>
                            <Text color="magenta" bold>
                                0ms
                            </Text>
                        </Box>
                        <Box flexDirection="column" paddingLeft={2}>
                            {Object.keys(ptpLog.requestPhase.decodedParams).length === 0 ? (
                                <Text dimColor>(no parameters)</Text>
                            ) : (
                                Object.entries(ptpLog.requestPhase.decodedParams).map(([key, value]) => {
                                    const formattedValue =
                                        typeof value === 'number' ? `0x${value.toString(16)}` : safeStringify(value)
                                    return (
                                        <Text key={key}>
                                            {key} set to {formattedValue}
                                        </Text>
                                    )
                                })
                            )}
                            {ptpLog.requestPhase.encodedParams?.map((encoded, idx) => {
                                const hex = Array.from(encoded.slice(0, 16))
                                    .map(b => b.toString(16).padStart(2, '0'))
                                    .join(' ')
                                return (
                                    <Text key={idx}>
                                        Bytes encoded as [{hex}
                                        {encoded.length > 16 ? '...' : ''}]
                                    </Text>
                                )
                            })}
                            {group.usbLogs
                                .filter(u => u.phase === 'request')
                                .map(usbLog => {
                                    const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                    return (
                                        <Text key={usbLog.id} dimColor>
                                            Transferred {formatBytes(usbLog.bytes)} via USB {direction}{' '}
                                            {usbLog.endpoint} {usbLog.endpointAddress}
                                        </Text>
                                    )
                                })}
                        </Box>
                    </Box>

                    {/* Data Phase */}
                    {ptpLog.dataPhase ? (
                        <Box flexDirection="column" marginTop={1}>
                            <Box>
                                <Text>{ptpLog.dataPhase.direction === 'in' ? 'Sent' : 'Received'} </Text>
                                <Text color="blue" bold>
                                    data
                                </Text>
                                <Text> in </Text>
                                <Text color="magenta" bold>
                                    {dataPhaseTime}ms
                                </Text>
                            </Box>
                            <Box flexDirection="column" paddingLeft={2}>
                                {ptpLog.type === 'ptp_transfer' && (
                                    <>
                                        {(() => {
                                            const percent = totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : 0
                                            const barLength = 30
                                            const filledLength = Math.round((percent / 100) * barLength)
                                            const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)
                                            const avgChunkSize =
                                                transferChunks.length > 0 ? transferredBytes / transferChunks.length : 0

                                            let speedText = ''
                                            if (transferChunks.length >= 2) {
                                                const lastChunk = transferChunks[transferChunks.length - 1]
                                                const prevChunk = transferChunks[transferChunks.length - 2]
                                                const timeDiff = (lastChunk.timestamp - prevChunk.timestamp) / 1000
                                                if (timeDiff > 0) {
                                                    const bytesPerSecond = lastChunk.bytes / timeDiff
                                                    speedText = `${formatBytes(bytesPerSecond, 1)}/s`
                                                }
                                            }

                                            return (
                                                <>
                                                    <Box>
                                                        <Text color="blue">{bar}</Text>
                                                        <Text> {percent.toFixed(1)}%</Text>
                                                    </Box>
                                                    <Text>
                                                        {speedText} ({formatBytes(totalBytes)} total,{' '}
                                                        {transferChunks.length} chunks @ {formatBytes(avgChunkSize, 0)}{' '}
                                                        each)
                                                    </Text>
                                                </>
                                            )
                                        })()}
                                    </>
                                )}
                                {ptpLog.dataPhase.decodedData !== undefined &&
                                    ptpLog.dataPhase.decodedData !== null &&
                                    formatJSON(ptpLog.dataPhase.decodedData, 0).map((line, idx) => (
                                        <Text key={idx}>{line}</Text>
                                    ))}
                                {ptpLog.dataPhase.encodedData && (
                                    <Text>
                                        Bytes encoded as [
                                        {Array.from(ptpLog.dataPhase.encodedData.slice(0, 16))
                                            .map(b => b.toString(16).padStart(2, '0'))
                                            .join(' ')}
                                        {ptpLog.dataPhase.encodedData.length > 16 ? '...' : ''}]
                                    </Text>
                                )}
                                {(() => {
                                    const dataUsbLogs = group.usbLogs.filter(u => u.phase === 'data')

                                    if (ptpLog.type === 'ptp_transfer' && dataUsbLogs.length > 0) {
                                        const direction = dataUsbLogs[0].direction === 'send' ? 'to' : 'from'
                                        const endpoint = dataUsbLogs[0].endpoint
                                        const endpointAddress = dataUsbLogs[0].endpointAddress

                                        return (
                                            <Text key="aggregate-usb" dimColor>
                                                Transferred {formatBytes(totalBytes)} via USB {direction} {endpoint}{' '}
                                                {endpointAddress}
                                            </Text>
                                        )
                                    }

                                    return dataUsbLogs.map(usbLog => {
                                        const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                        return (
                                            <Text key={usbLog.id} dimColor>
                                                Transferred {formatBytes(usbLog.bytes)} via USB {direction}{' '}
                                                {usbLog.endpoint} {usbLog.endpointAddress}
                                            </Text>
                                        )
                                    })
                                })()}
                            </Box>
                        </Box>
                    ) : !ptpLog.responsePhase ? (
                        <Box flexDirection="column" marginTop={1}>
                            <Box>
                                <Text>Receiving </Text>
                                <Text color="blue" bold>
                                    data
                                </Text>
                                <Text> </Text>
                                <Text color="magenta" bold>
                                    <Spinner type="dots" />
                                </Text>
                            </Box>
                        </Box>
                    ) : null}

                    {/* Response Phase */}
                    {ptpLog.responsePhase ? (
                        <Box flexDirection="column" marginTop={1}>
                            <Box>
                                <Text>Received </Text>
                                <Text color={hasError ? 'red' : 'green'} bold>
                                    response
                                </Text>
                                <Text> in </Text>
                                <Text color="magenta" bold>
                                    {responsePhaseTime}ms
                                </Text>
                            </Box>
                            <Box flexDirection="column" paddingLeft={2}>
                                <Text>
                                    Response code:{' '}
                                    {responseDefinitions.find(r => r.code === ptpLog.responsePhase?.code)?.name ||
                                        ptpLog.responsePhase.code}{' '}
                                    (0x{ptpLog.responsePhase.code.toString(16)})
                                    {(() => {
                                        const responseDef = responseDefinitions.find(
                                            r => r.code === ptpLog.responsePhase!.code
                                        )
                                        return responseDef ? ` - ${responseDef.description}` : ''
                                    })()}
                                </Text>
                                {group.usbLogs
                                    .filter(u => u.phase === 'response')
                                    .map(usbLog => {
                                        const direction = usbLog.direction === 'send' ? 'to' : 'from'
                                        return (
                                            <Text key={usbLog.id} dimColor>
                                                Transferred {formatBytes(usbLog.bytes)} via USB {direction}{' '}
                                                {usbLog.endpoint} {usbLog.endpointAddress}
                                            </Text>
                                        )
                                    })}
                            </Box>
                        </Box>
                    ) : (
                        <Box flexDirection="column" marginTop={1}>
                            <Box>
                                <Text>Receiving </Text>
                                <Text color="blue" bold>
                                    response
                                </Text>
                                <Text> </Text>
                                <Text color="magenta" bold>
                                    <Spinner type="dots" />
                                </Text>
                            </Box>
                        </Box>
                    )}
                </>
            )}
        </Box>
    )
}
