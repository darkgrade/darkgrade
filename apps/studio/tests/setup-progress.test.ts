import type { LocalModelStatus, VoiceEngineStatus } from '@shared/ipc'
import { summarizeSetup } from '@shared/setup-progress'
import { describe, expect, it } from 'vitest'

function voiceStatus(change: Partial<VoiceEngineStatus>): VoiceEngineStatus {
    return {
        phase: 'not-downloaded',
        receivedBytes: 0,
        totalBytes: 0,
        port: null,
        message: null,
        setupStep: null,
        speechModelBytes: 180,
        ...change,
    }
}

function assistantStatus(change: Partial<LocalModelStatus>): LocalModelStatus {
    return { phase: 'not-downloaded', receivedBytes: 0, totalBytes: 0, port: null, message: null, ...change }
}

describe('setup progress across Python, tools, speech and the assistant', () => {
    it('starts at zero with every step waiting', () => {
        const summary = summarizeSetup(voiceStatus({}), assistantStatus({}))
        expect(summary.fraction).toBe(0)
        expect(summary.steps.map(step => step.state)).toEqual(['waiting', 'waiting', 'waiting', 'waiting'])
        expect(summary.currentNumber).toBe(1)
    })

    it('marks earlier steps done and names the one in progress', () => {
        const summary = summarizeSetup(
            voiceStatus({ phase: 'starting', setupStep: 'tools' }),
            assistantStatus({ phase: 'downloading', receivedBytes: 1_000, totalBytes: 4_000 })
        )
        expect(summary.steps.map(step => step.state)).toEqual(['done', 'working', 'waiting', 'working'])
        expect(summary.current?.id).toBe('tools')
        expect(summary.currentNumber).toBe(2)
    })

    it('weights the big assistant download as most of the bar', () => {
        const halfWay = summarizeSetup(
            voiceStatus({ phase: 'ready' }),
            assistantStatus({ phase: 'downloading', receivedBytes: 50, totalBytes: 100 })
        )
        expect(halfWay.fraction).toBeCloseTo(0.22 + 0.78 * 0.5)
        expect(halfWay.current?.id).toBe('assistant')
    })

    it('counts the speech download by bytes and loading as nearly finished', () => {
        const downloading = summarizeSetup(
            voiceStatus({ phase: 'downloading', setupStep: 'speech-model', receivedBytes: 90, totalBytes: 180 }),
            null
        )
        expect(downloading.steps[2]).toMatchObject({ state: 'working', fraction: 0.5 })
        const loading = summarizeSetup(voiceStatus({ phase: 'starting', setupStep: 'loading' }), null)
        expect(loading.steps[2].state).toBe('working')
        expect(loading.steps[2].fraction).toBeGreaterThan(0.5)
    })

    it('reports one overall download, not the current step', () => {
        const summary = summarizeSetup(
            voiceStatus({ phase: 'ready' }),
            assistantStatus({ phase: 'downloading', receivedBytes: 1_000, totalBytes: 6_000 })
        )
        expect(summary.totalBytes).toBe(6_180)
        expect(summary.receivedBytes).toBe(180 + 1_000)
        const fresh = summarizeSetup(voiceStatus({}), assistantStatus({ totalBytes: 6_000 }))
        expect(fresh).toMatchObject({ receivedBytes: 0, totalBytes: 6_180 })
    })

    it('is complete only when voice is ready and the assistant is loaded or cached', () => {
        expect(summarizeSetup(voiceStatus({ phase: 'ready' }), assistantStatus({ phase: 'ready' })).complete).toBe(true)
        expect(summarizeSetup(voiceStatus({ phase: 'ready' }), assistantStatus({ phase: 'idle' })).complete).toBe(true)
        const unfinished = summarizeSetup(voiceStatus({ phase: 'ready' }), assistantStatus({ phase: 'starting' }))
        expect(unfinished.complete).toBe(false)
        expect(unfinished.fraction).toBeLessThan(1)
    })
})
