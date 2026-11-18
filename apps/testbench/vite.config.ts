import { defineConfig } from 'vite'

export const contentSecurityPolicy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "connect-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
].join('; ')

const headers = {
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), bluetooth=()',
}

export default defineConfig({
    root: import.meta.dirname,
    base: './',
    server: {
        host: 'localhost',
        port: 5230,
        strictPort: true,
        hmr: false,
        allowedHosts: ['localhost'],
        cors: false,
        fs: { strict: true, allow: [import.meta.dirname] },
        headers,
    },
    preview: { host: 'localhost', port: 5230, strictPort: true, headers },
    build: { sourcemap: false, target: 'es2022' },
})
