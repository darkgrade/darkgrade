/** A tool call in the OpenAI chat format llama-server uses. */
export interface TextToolCall {
    id: string
    type: 'function'
    function: { name: string; arguments: string }
}

/**
 * The model sometimes writes a tool call as plain JSON instead of a structured call, which used to
 * reach the user as the reply "{". Recovers {"name": ..., "arguments": {...}} (one or a list).
 */
export function toolCallsWrittenAsText(
    content: string | null | undefined,
    toolNames: ReadonlySet<string>,
    step: number
): TextToolCall[] {
    const text = content?.trim() ?? ''
    if (!text.startsWith('{') && !text.startsWith('[')) return []
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return []
    }
    const candidates = Array.isArray(parsed) ? parsed : [parsed]
    return candidates.flatMap((candidate, index) => {
        const call = candidate as { name?: unknown; arguments?: unknown; parameters?: unknown }
        if (typeof call?.name !== 'string' || !toolNames.has(call.name)) return []
        const input = call.arguments ?? call.parameters ?? {}
        const argumentsText = typeof input === 'string' ? input : JSON.stringify(input)
        return [
            {
                id: `text-call-${step}-${index}`,
                type: 'function' as const,
                function: { name: call.name, arguments: argumentsText },
            },
        ]
    })
}
