import { Box, Text } from 'ink'
import { PTPEventLog } from '../../logger'
import { safeStringify } from '../formatters/safe-stringify'
import { formatTimestamp } from '../formatters/timestamp-formatter'

interface EventLogEntryProps {
    eventLog: PTPEventLog
    expanded: boolean
    groupTimestamp: number
}

export function EventLogEntry({ eventLog, expanded, groupTimestamp }: EventLogEntryProps) {
    const hasParams = Object.keys(eventLog.decodedParams).length > 0
    const timestamp = formatTimestamp(groupTimestamp)

    return (
        <Box
            flexDirection="column"
            width={100}
            paddingX={2}
            paddingY={1}
            borderStyle="round"
            borderLeft
            borderColor="magenta"
        >
            <Box>
                <Text bold>{timestamp} </Text>
                <Text color="magenta" bold>
                    {eventLog.eventName}
                </Text>
                <Text bold> event received</Text>
            </Box>
            {expanded && (
                <>
                    <Box marginTop={1}>
                        <Text>Session 0x{eventLog.sessionId.toString(16)}</Text>
                    </Box>
                    <Box flexDirection="column" marginTop={1}>
                        <Text bold>Parameters</Text>
                        <Box flexDirection="column" paddingLeft={2}>
                            {hasParams ? (
                                Object.entries(eventLog.decodedParams).map(([key, value]) => (
                                    <Text key={key}>
                                        {key} ={' '}
                                        {typeof value === 'number' ? '0x' + value.toString(16) : safeStringify(value)}
                                    </Text>
                                ))
                            ) : (
                                <Text dimColor>(none)</Text>
                            )}
                        </Box>
                    </Box>
                </>
            )}
        </Box>
    )
}
