import { OK } from '@ptp/definitions/response-definitions'
import { Box, Text } from 'ink'
import Spinner from 'ink-spinner'
import React from 'react'
import { ConsoleLog, Logger, PTPEventLog, PTPOperationLog, PTPTransferLog, USBTransferLog } from '../logger'
import { formatBytes, formatJSON, formatTimestamp, safeStringify } from './formatters'

interface TransactionGroup {
    key: string
    sessionId?: number
    transactionId?: number
    ptpLog?: PTPOperationLog | PTPTransferLog
    consoleLog?: ConsoleLog
    eventLog?: PTPEventLog
    usbLogs: USBTransferLog[]
    timestamp: number
}

type ResponseDefinitions = Array<{ code: number; name: string; description: string }>

function groupTransactions(logger: Logger): TransactionGroup[] {
    const groups: TransactionGroup[] = []
    for (const { key, logs, timestamp } of logger.getOrderedTransactions()) {
        if (logs.length === 0) continue
        const firstLog = logs[0]
        const group: TransactionGroup = { key, usbLogs: [], timestamp }
        if (firstLog.type === 'console') group.consoleLog = firstLog
        else if (firstLog.type === 'ptp_event') group.eventLog = firstLog
        else {
            group.sessionId = firstLog.sessionId
            group.transactionId = firstLog.transactionId
            for (const log of logs) {
                if (log.type === 'ptp_operation' || log.type === 'ptp_transfer') group.ptpLog = log
                else if (log.type === 'usb_transfer') group.usbLogs.push(log)
            }
        }
        groups.push(group)
    }
    return groups.sort((a, b) => a.timestamp - b.timestamp)
}

const isComplete = (group: TransactionGroup) =>
    Boolean(group.consoleLog || group.eventLog || group.ptpLog?.responsePhase)

export function InkLogger({ logger }: { logger: Logger }) {
    const [logsVersion, setLogsVersion] = React.useState(0)
    React.useEffect(() => logger.onChange(() => setLogsVersion(version => version + 1)), [logger])
    const groups = React.useMemo(() => groupTransactions(logger), [logger, logsVersion])
    const expanded = React.useMemo(() => logger.getConfig().expanded ?? true, [logger])
    const responseDefinitions = React.useMemo(() => Object.values(logger.getResponseRegistry()), [logger])

    const renderGroup = (group: TransactionGroup) => {
        if (group.consoleLog)
            return <ConsoleLogEntry key={group.key} log={group.consoleLog} expanded={expanded} at={group.timestamp} />
        if (group.eventLog)
            return <EventLogEntry key={group.key} log={group.eventLog} expanded={expanded} at={group.timestamp} />
        if (!group.ptpLog) return null
        return (
            <PTPOperationLogEntry key={group.key} group={group} expanded={expanded} responses={responseDefinitions} />
        )
    }

    // The logger owns retention; keeping a second history here defeats its memory bound.
    return (
        <Box flexDirection="column" rowGap={1}>
            <Box flexDirection="column">{groups.filter(isComplete).map(renderGroup)}</Box>
            {groups.filter(group => !isComplete(group)).map(renderGroup)}
        </Box>
    )
}

function Card({ color, children }: { color: string; children: React.ReactNode }) {
    return (
        <Box
            flexDirection="column"
            width={100}
            paddingX={2}
            paddingY={1}
            borderStyle="round"
            borderLeft
            borderColor={color}
        >
            {children}
        </Box>
    )
}

type EntryProps<Log> = { log: Log; expanded: boolean; at: number }

function ConsoleLogEntry({ log, expanded, at }: EntryProps<ConsoleLog>) {
    const level = log.consoleLevel
    const color = ({ log: 'cyan', info: 'cyan', warn: 'yellow', error: 'red' } as const)[level]
    const levelLabel = level === 'log' ? 'Debug' : level.charAt(0).toUpperCase() + level.slice(1)
    const formatted = log.args.map(arg => (typeof arg === 'object' ? safeStringify(arg) : String(arg))).join(' ')
    return (
        <Card color="gray">
            <Text>
                <Text bold>{formatTimestamp(at)} [</Text>
                <Text color={color} bold>
                    {levelLabel}
                </Text>
                <Text bold>]</Text>
                {expanded && <Text> {formatted}</Text>}
            </Text>
        </Card>
    )
}

const hexParameter = (value: number | bigint | string | object) =>
    typeof value === 'number' ? `0x${value.toString(16)}` : safeStringify(value)

function EventLogEntry({ log, expanded, at }: EntryProps<PTPEventLog>) {
    const parameters = Object.entries(log.decodedParams)
    return (
        <Card color="magenta">
            <Box>
                <Text bold>{formatTimestamp(at)} </Text>
                <Text color="magenta" bold>
                    {log.eventName}
                </Text>
                <Text bold> event received</Text>
            </Box>
            {expanded && (
                <>
                    <Box marginTop={1}>
                        <Text>Session 0x{log.sessionId.toString(16)}</Text>
                    </Box>
                    <Box flexDirection="column" marginTop={1}>
                        <Text bold>Parameters</Text>
                        <Box flexDirection="column" paddingLeft={2}>
                            {parameters.length === 0 && <Text dimColor>(none)</Text>}
                            {parameters.map(([key, value]) => (
                                <Text key={key}>
                                    {key} = {hexParameter(value)}
                                </Text>
                            ))}
                        </Box>
                    </Box>
                </>
            )}
        </Card>
    )
}

const hexPreview = (bytes: Uint8Array) =>
    Array.from(bytes.slice(0, 16))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join(' ') + (bytes.length > 16 ? '...' : '')

function UsbLines({ logs }: { logs: USBTransferLog[] }) {
    return (
        <>
            {logs.map(usbLog => (
                <Text key={usbLog.id} dimColor>
                    Transferred {formatBytes(usbLog.bytes)} via USB {usbLog.direction === 'send' ? 'to' : 'from'}{' '}
                    {usbLog.endpoint} {usbLog.endpointAddress}
                </Text>
            ))}
        </>
    )
}

function Phase({
    verb,
    label,
    labelColor = 'blue',
    milliseconds,
    children,
}: {
    verb: string
    label: string
    labelColor?: string
    milliseconds?: number
    children?: React.ReactNode
}) {
    return (
        <Box flexDirection="column" marginTop={1}>
            <Box>
                <Text>{verb} </Text>
                <Text color={labelColor} bold>
                    {label}
                </Text>
                <Text>{milliseconds === undefined ? ' ' : ' in '}</Text>
                <Text color="magenta" bold>
                    {milliseconds === undefined ? <Spinner type="dots" /> : `${milliseconds}ms`}
                </Text>
            </Box>
            {children && (
                <Box flexDirection="column" paddingLeft={2}>
                    {children}
                </Box>
            )}
        </Box>
    )
}

function TransferProgress({ log }: { log: PTPTransferLog }) {
    const { chunks, totalBytes, transferredBytes } = log
    const percent = totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : 0
    const barLength = 30
    const filledLength = Math.round((percent / 100) * barLength)
    const averageChunkBytes = chunks.length > 0 ? transferredBytes / chunks.length : 0
    const [previous, last] = chunks.slice(-2)
    const elapsedSeconds = chunks.length >= 2 ? (last.timestamp - previous.timestamp) / 1000 : 0
    const speedText = elapsedSeconds > 0 ? `${formatBytes(last.bytes / elapsedSeconds, 1)}/s` : ''
    return (
        <>
            <Box>
                <Text color="blue">{'█'.repeat(filledLength) + '░'.repeat(barLength - filledLength)}</Text>
                <Text> {percent.toFixed(1)}%</Text>
            </Box>
            <Text>
                {speedText} ({formatBytes(totalBytes)} total, {chunks.length} chunks @{' '}
                {formatBytes(averageChunkBytes, 0)} each)
            </Text>
        </>
    )
}

function PTPOperationLogEntry({
    group,
    expanded,
    responses,
}: {
    group: TransactionGroup
    expanded: boolean
    responses: ResponseDefinitions
}) {
    const ptpLog = group.ptpLog!
    const { requestPhase, dataPhase, responsePhase } = ptpLog
    const hasError = responsePhase && responsePhase.code !== OK.code
    const isSuccess = responsePhase && responsePhase.code === OK.code
    const startTime = requestPhase.timestamp
    const duration = (responsePhase?.timestamp || Date.now()) - startTime
    let dataPhaseTime: number
    let responsePhaseTime: number
    if (ptpLog.type === 'ptp_transfer') {
        const firstChunkTime = ptpLog.chunks[0]?.timestamp || startTime
        const lastChunkTime = ptpLog.chunks[ptpLog.chunks.length - 1]?.timestamp || Date.now()
        dataPhaseTime = lastChunkTime - firstChunkTime
        responsePhaseTime = responsePhase ? responsePhase.timestamp - lastChunkTime : 0
    } else {
        dataPhaseTime = dataPhase ? dataPhase.timestamp - startTime : 0
        responsePhaseTime = responsePhase ? responsePhase.timestamp - (dataPhase?.timestamp || startTime) : 0
    }
    const usbLogs = (phase: USBTransferLog['phase']) => group.usbLogs.filter(log => log.phase === phase)
    const dataUsbLogs = usbLogs('data')
    const response = responsePhase && responses.find(definition => definition.code === responsePhase.code)
    const parameters = Object.entries(requestPhase.decodedParams)

    return (
        <Card color="blue">
            <Box>
                <Text bold>{formatTimestamp(group.timestamp)} </Text>
                <Text color="blue" bold>
                    {requestPhase.operationName}{' '}
                </Text>
                <Text bold>{responsePhase ? 'ran for' : 'running'} </Text>
                {responsePhase ? (
                    <>
                        <Text color="magenta" bold>
                            {duration}ms{' '}
                        </Text>
                        <Text color={hasError ? 'red' : isSuccess ? 'green' : 'yellow'} bold>
                            {hasError ? '✗' : isSuccess ? '✓' : '⋯'}
                        </Text>
                    </>
                ) : (
                    <Text color="magenta" bold>
                        <Spinner type="dots" />{' '}
                    </Text>
                )}
            </Box>
            {expanded && (
                <>
                    <Box marginTop={1}>
                        <Text dimColor>
                            Session 0x{group.sessionId!.toString(16)}, transaction {group.transactionId}
                        </Text>
                    </Box>
                    <Phase verb="Sent" label="request" milliseconds={0}>
                        {parameters.length === 0 ? (
                            <Text dimColor>(no parameters)</Text>
                        ) : (
                            parameters.map(([key, value]) => (
                                <Text key={key}>
                                    {key} set to {hexParameter(value)}
                                </Text>
                            ))
                        )}
                        {requestPhase.encodedParams?.map((encoded, index) => (
                            <Text key={index}>Bytes encoded as [{hexPreview(encoded)}]</Text>
                        ))}
                        <UsbLines logs={usbLogs('request')} />
                    </Phase>
                    {dataPhase ? (
                        <Phase
                            verb={dataPhase.direction === 'in' ? 'Sent' : 'Received'}
                            label="data"
                            milliseconds={dataPhaseTime}
                        >
                            {ptpLog.type === 'ptp_transfer' && <TransferProgress log={ptpLog} />}
                            {dataPhase.decodedData !== undefined &&
                                dataPhase.decodedData !== null &&
                                formatJSON(dataPhase.decodedData, 0).map((line, index) => (
                                    <Text key={index}>{line}</Text>
                                ))}
                            {dataPhase.encodedData && (
                                <Text>Bytes encoded as [{hexPreview(dataPhase.encodedData)}]</Text>
                            )}
                            {ptpLog.type === 'ptp_transfer' && dataUsbLogs.length > 0 ? (
                                <Text key="aggregate-usb" dimColor>
                                    Transferred {formatBytes(ptpLog.totalBytes)} via USB{' '}
                                    {dataUsbLogs[0].direction === 'send' ? 'to' : 'from'} {dataUsbLogs[0].endpoint}{' '}
                                    {dataUsbLogs[0].endpointAddress}
                                </Text>
                            ) : (
                                <UsbLines logs={dataUsbLogs} />
                            )}
                        </Phase>
                    ) : (
                        !responsePhase && <Phase verb="Receiving" label="data" />
                    )}
                    {responsePhase ? (
                        <Phase
                            verb="Received"
                            label="response"
                            labelColor={hasError ? 'red' : 'green'}
                            milliseconds={responsePhaseTime}
                        >
                            <Text>
                                Response code: {response?.name || responsePhase.code} (0x
                                {responsePhase.code.toString(16)}){response ? ` - ${response.description}` : ''}
                            </Text>
                            <UsbLines logs={usbLogs('response')} />
                        </Phase>
                    ) : (
                        <Phase verb="Receiving" label="response" />
                    )}
                </>
            )}
        </Card>
    )
}
