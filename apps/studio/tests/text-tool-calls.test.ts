import { toolCallsWrittenAsText } from '@main/assistant/text-tool-calls'
import { describe, expect, it } from 'vitest'

const TOOLS = new Set(['analyze_frame', 'adjust_exposure'])

describe('toolCallsWrittenAsText', () => {
    it('recovers a tool call the model wrote as JSON', () => {
        const calls = toolCallsWrittenAsText('{"name": "adjust_exposure", "arguments": {"stops": 1}}', TOOLS, 2)
        expect(calls).toEqual([
            { id: 'text-call-2-0', type: 'function', function: { name: 'adjust_exposure', arguments: '{"stops":1}' } },
        ])
    })

    it('ignores ordinary replies and unknown tools', () => {
        expect(toolCallsWrittenAsText('Exposure looks good.', TOOLS, 1)).toEqual([])
        expect(toolCallsWrittenAsText('{"name": "delete_everything", "arguments": {}}', TOOLS, 1)).toEqual([])
        expect(toolCallsWrittenAsText('{ not json', TOOLS, 1)).toEqual([])
    })
})
