import type { WebContents } from 'electron'

/** Only web links may be handed to the operating system. Credentials are never forwarded. */
export function externalWebUrl(value: string): string | undefined {
    if (/[\\\u0000-\u0020]/.test(value)) return
    try {
        const url = new URL(value)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return
        return url.href
    } catch { return }
}

export function rendererDocumentUrl(bundledUrl: string, packaged: boolean, developmentUrl?: string): string {
    if (packaged || !developmentUrl) return bundledUrl
    const allowed = externalWebUrl(developmentUrl)
    if (!allowed) throw new Error('The development renderer must use an HTTP(S) URL without credentials')
    return allowed
}

/** Hash routes share the trusted document; other paths, queries and origins do not. */
export function isTrustedRendererDocument(value: string, expected: string): boolean {
    try {
        const observed = new URL(value), trusted = new URL(expected)
        if (observed.username || observed.password || trusted.username || trusted.password) return false
        return ['file:', 'http:', 'https:'].includes(trusted.protocol) &&
            observed.protocol === trusted.protocol && observed.host === trusted.host &&
            observed.pathname === trusted.pathname && observed.search === trusted.search
    } catch { return false }
}

export function isTrustedRendererFrame(frame: { url: string; parent: unknown } | null, expected: string) {
    return frame?.parent === null && isTrustedRendererDocument(frame.url, expected)
}

export function protectRenderer(
    contents: Pick<WebContents, 'on' | 'setWindowOpenHandler'>,
    expected: string,
    openExternal: (url: string) => Promise<unknown>,
) {
    contents.on('will-frame-navigate', event => {
        if (!event.isMainFrame || !isTrustedRendererDocument(event.url, expected)) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) => {
        const allowed = externalWebUrl(url)
        if (allowed) void openExternal(allowed).catch(() => {})
        return { action: 'deny' }
    })
}
