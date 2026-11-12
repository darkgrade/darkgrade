import { describeMicrophoneError } from '@shared/microphone-errors'
import { describe, expect, it } from 'vitest'

describe('microphone errors', () => {
    it('says macOS is blocking the microphone and where to turn it on', () => {
        const problem = describeMicrophoneError(new DOMException('Permission denied', 'NotAllowedError'))
        expect(problem?.blockedByMacos).toBe(true)
        expect(problem?.message).toContain('System Settings')
        expect(problem?.message).toContain('Microphone')
    })

    it('explains a missing or busy microphone without pointing at settings', () => {
        const missing = describeMicrophoneError(new DOMException('', 'NotFoundError'))
        const busy = describeMicrophoneError(new DOMException('', 'NotReadableError'))
        expect(missing?.blockedByMacos).toBe(false)
        expect(busy?.blockedByMacos).toBe(false)
        expect(missing?.message).not.toBe(busy?.message)
    })

    it('leaves other errors to the caller', () => {
        expect(describeMicrophoneError(new Error('boom'))).toBeNull()
    })
})
