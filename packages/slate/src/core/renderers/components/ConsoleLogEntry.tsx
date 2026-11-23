import { Box, Text } from 'ink'
import { ConsoleLog } from '../../logger'
import { safeStringify } from '../formatters/safe-stringify'
import { formatTimestamp } from '../formatters/timestamp-formatter'

interface ConsoleLogEntryProps {
    consoleLog: ConsoleLog
    expanded: boolean
    groupTimestamp: number
}

export function ConsoleLogEntry({ consoleLog, expanded, groupTimestamp }: ConsoleLogEntryProps) {
    const colorMap = {
        log: 'cyan',
        info: 'cyan',
        warn: 'yellow',
        error: 'red',
    } as const
    const color = colorMap[consoleLog.consoleLevel]
    const levelLabel =
        consoleLog.consoleLevel === 'log'
            ? 'Debug'
            : consoleLog.consoleLevel.charAt(0).toUpperCase() + consoleLog.consoleLevel.slice(1)
    const formatted = consoleLog.args.map(arg => (typeof arg === 'object' ? safeStringify(arg) : String(arg))).join(' ')

    const timestamp = formatTimestamp(groupTimestamp)

    return (
        <Box
            flexDirection="column"
            width={100}
            paddingX={2}
            paddingY={1}
            borderStyle="round"
            borderLeft
            borderColor="gray"
        >
            <Text>
                <Text bold>{timestamp} [</Text>
                <Text color={color} bold>
                    {levelLabel}
                </Text>
                <Text bold>]</Text>
                {expanded && (
                    <>
                        <Text bold> </Text>
                        <Text>{formatted}</Text>
                    </>
                )}
            </Text>
        </Box>
    )
}
