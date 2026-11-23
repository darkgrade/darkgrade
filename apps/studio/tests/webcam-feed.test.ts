import { usesWebcamFeed } from '@shared/ipc'
import { describeWebcamError } from '@shared/webcam-errors'
import { describe, expect, it } from 'vitest'

describe('webcam feed choice', () => {
    it('replaces the camera only while Developer Mode is on', () => {
        expect(usesWebcamFeed({ developerMode: true, liveFeed: 'webcam' })).toBe(true)
        expect(usesWebcamFeed({ developerMode: false, liveFeed: 'webcam' })).toBe(false)
        expect(usesWebcamFeed({ developerMode: true, liveFeed: 'camera' })).toBe(false)
    })
})

describe('webcam errors', () => {
    it('says where macOS is blocking the camera', () => {
        const message = describeWebcamError(new DOMException('Permission denied', 'NotAllowedError'))
        expect(message).toContain('Privacy & Security → Camera')
    })

    it('tells a missing webcam from a busy one', () => {
        const missing = describeWebcamError(new DOMException('', 'NotFoundError'))
        const busy = describeWebcamError(new DOMException('', 'NotReadableError'))
        expect(missing).toContain('Continuity Camera')
        expect(busy).toContain('busy')
    })

    it('passes other errors through', () => {
        expect(describeWebcamError(new Error('boom'))).toBe('boom')
    })
})
