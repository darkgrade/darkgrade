import { describe, expect, it, vi } from 'vitest'
import { externalWebUrl, isTrustedRendererDocument, isTrustedRendererFrame,
    protectRenderer, rendererDocumentUrl } from '@main/renderer-security'

const bundled = 'file:///application/renderer/index.html'
const development = 'http://localhost:5173/'

describe('Renderer security boundary', () => {
    it.each(['javascript:alert(1)', 'file:///private/document', 'data:text/html,test',
        'custom:run', '//example.invalid', 'https://user:pass@example.invalid/',
        'https://example.invalid\\path', 'https://example.invalid/\n'])('does not hand %s to an OS handler', value => {
        expect(externalWebUrl(value)).toBeUndefined()
    })
    it('allows credential-free web links and never uses a development URL in a packaged app', () => {
        expect(externalWebUrl('https://example.invalid/help')).toBe('https://example.invalid/help')
        expect(rendererDocumentUrl(bundled, true, development)).toBe(bundled)
        expect(rendererDocumentUrl(bundled, false, development)).toBe(development)
        expect(() => rendererDocumentUrl(bundled, false, 'custom:run')).toThrow()
    })
    it.each([bundled, development])('allows only the configured document and its hash routes: %s', expected => {
        expect(isTrustedRendererDocument(expected + '#preferences', expected)).toBe(true)
        for (const value of ['https://example.invalid/', 'http://localhost:5174/',
            expected.replace('index.html', 'other.html') + '?untrusted=1', expected + '?changed=1'])
            expect(isTrustedRendererDocument(value, expected)).toBe(false)
        expect(isTrustedRendererFrame({ url: expected, parent: null }, expected)).toBe(true)
        expect(isTrustedRendererFrame({ url: expected, parent: {} }, expected)).toBe(false)
        expect(isTrustedRendererFrame(null, expected)).toBe(false)
    })
    it('blocks navigation and popup schemes before invoking external handlers', async () => {
        const handlers: Record<string, Function> = {}
        const external = vi.fn(async () => {})
        const contents = {
            on: (name: string, listener: Function) => { handlers[name] = listener },
            setWindowOpenHandler: (listener: Function) => { handlers.popup = listener },
        }
        protectRenderer(contents as any, bundled, external)
        const preventDefault = vi.fn()
        handlers['will-frame-navigate']({ url: 'https://example.invalid/', isMainFrame: true, preventDefault })
        handlers['will-frame-navigate']({ url: bundled, isMainFrame: false, preventDefault })
        expect(preventDefault).toHaveBeenCalledTimes(2)
        expect(handlers.popup({ url: 'custom:run' })).toEqual({ action: 'deny' })
        expect(external).not.toHaveBeenCalled()
        handlers.popup({ url: 'https://example.invalid/help' })
        expect(external).toHaveBeenCalledWith('https://example.invalid/help')
    })
})
