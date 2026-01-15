import { Box, useStdout } from 'ink'
import React from 'react'
import { ConsoleLog, Logger, PTPEventLog, PTPOperationLog, PTPTransferLog, USBTransferLog } from '../logger'
import { ConsoleLogEntry } from './components/ConsoleLogEntry'
import { EventLogEntry } from './components/EventLogEntry'
import { PTPOperationLogEntry, TransactionGroup } from './components/PTPOperationLogEntry'
import { StaticList } from './components/StaticList'

interface InkLoggerProps {
    logger: Logger
}

export function InkLogger({ logger }: InkLoggerProps) {
    const [logsVersion, setLogsVersion] = React.useState(0)
    const { stdout } = useStdout()

    React.useEffect(() => {
        const listener = () => {
            setLogsVersion(v => v + 1)
        }
        logger.onChange(listener)
    }, [logger])

    const allGroups = React.useMemo(() => {
        const orderedTransactions = logger.getOrderedTransactions()
        const groups: TransactionGroup[] = []

        for (const { key, logs, timestamp } of orderedTransactions) {
            if (logs.length === 0) continue

            const firstLog = logs[0]
            const group: TransactionGroup = {
                key,
                usbLogs: [],
                timestamp,
            }

            if (firstLog.type === 'console') {
                group.consoleLog = firstLog as ConsoleLog
            } else if (firstLog.type === 'ptp_event') {
                group.eventLog = firstLog as PTPEventLog
            } else {
                group.sessionId = firstLog.sessionId
                group.transactionId = firstLog.transactionId

                for (const log of logs) {
                    if (log.type === 'ptp_operation' || log.type === 'ptp_transfer') {
                        group.ptpLog = log as PTPOperationLog | PTPTransferLog
                    } else if (log.type === 'usb_transfer') {
                        group.usbLogs.push(log as USBTransferLog)
                    }
                }
            }

            groups.push(group)
        }

        return groups.sort((a, b) => a.timestamp - b.timestamp)
    }, [logger, logsVersion])

    const config = React.useMemo(() => logger.getConfig(), [logger])

    const { staticGroups, dynamicGroups } = React.useMemo(() => {
        const isComplete = (group: TransactionGroup) => {
            // Console logs and event logs are always complete
            if (group.consoleLog || group.eventLog) return true

            // PTP operations are complete when they have a response
            if (group.ptpLog && group.ptpLog.responsePhase) return true

            return false
        }

        const static_: TransactionGroup[] = []
        const dynamic: TransactionGroup[] = []

        for (const group of allGroups) {
            if (isComplete(group)) {
                static_.push(group)
            } else {
                dynamic.push(group)
            }
        }

        return { staticGroups: static_, dynamicGroups: dynamic }
    }, [allGroups])

    const responseRegistry = React.useMemo(() => logger.getResponseRegistry(), [logger])

    const renderGroup = (group: TransactionGroup) => {
        const expanded = config.expanded ?? true

        if (group.consoleLog) {
            return (
                <ConsoleLogEntry
                    key={group.key}
                    consoleLog={group.consoleLog}
                    expanded={expanded}
                    groupTimestamp={group.timestamp}
                />
            )
        }

        if (group.eventLog) {
            return (
                <EventLogEntry
                    key={group.key}
                    eventLog={group.eventLog}
                    expanded={expanded}
                    groupTimestamp={group.timestamp}
                />
            )
        }

        if (!group.ptpLog) return null

        return (
            <PTPOperationLogEntry
                key={group.key}
                group={group}
                expanded={expanded}
                responseRegistry={responseRegistry}
            />
        )
    }

    return (
        <Box flexDirection="column" rowGap={1}>
            <StaticList items={staticGroups}>{group => renderGroup(group)}</StaticList>
            {dynamicGroups.map(group => renderGroup(group))}
        </Box>
    )
}
