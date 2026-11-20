import { execFileSync } from 'node:child_process'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'

export default defineConfig({
    define: {
        global: 'globalThis',
        __LINK_TELEMETRY_REVISION__: JSON.stringify(process.env.LINK_REVISION || execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()),
        __LINK_TELEMETRY_DIRTY__: JSON.stringify(execFileSync('git', ['status', '--porcelain', '--untracked-files=no']).toString().trim().length > 0),
    },
    plugins: [
        // Emits dist/index.d.ts (+ tree) with @camera/@core/... aliases
        // rewritten to relative paths so consumers can resolve them.
        dts({
            include: ['src'],
            entryRoot: 'src',
            beforeWriteFile(filePath, content) {
                // Diagnostics also serve NodeNext consumers such as the collector.
                if ((filePath.includes('/contribute/') || filePath.includes('/cli/')) && filePath.endsWith('.d.ts'))
                    content = content.replace(/((?:from\s+|import\()['"])(\.[^'"]+)(['"])/g,
                        (_, prefix, path, quote) => `${prefix}${/\.[cm]?[jt]s$/.test(path) ? path : path + '.js'}${quote}`)
                return { filePath, content }
            },
        }),
    ],
    resolve: {
        alias: {
            '@contribute': resolve(__dirname, './src/contribute'),
            '@workflows': resolve(__dirname, './src/workflows'),
            '@vendors': resolve(__dirname, './src/vendors'),
            '@camera': resolve(__dirname, './src/camera'),
            '@core': resolve(__dirname, './src/core'),
            '@transport': resolve(__dirname, './src/transport'),
            '@factories': resolve(__dirname, './src/factories'),
            '@api': resolve(__dirname, './src/api'),
            '@constants': resolve(__dirname, './src/constants'),
            '@ptp': resolve(__dirname, './src/ptp'),
            '@runtime': resolve(__dirname, './src/runtime'),
        },
    },
    build: {
        lib: {
            // The camera library, and the shared runtime (operation ordering, leases, MCP tools)
            // that hosts embed. The runtime entries stay separate so a browser never loads
            // the Node-only lease coordinator or the USB stack.
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                'cli/index': resolve(__dirname, 'src/cli/index.ts'),
                'runtime/index': resolve(__dirname, 'src/runtime/index.ts'),
                'runtime/browser': resolve(__dirname, 'src/runtime/browser.ts'),
                'runtime/mcp': resolve(__dirname, 'src/runtime/mcp.ts'),
                'runtime/ownership': resolve(__dirname, 'src/runtime/ownership.ts'),
                'contribute/index': resolve(__dirname, 'src/contribute/index.ts'),
                'contribute/application': resolve(__dirname, 'src/contribute/application.ts'),
                'contribute/batch': resolve(__dirname, 'src/contribute/batch.ts'),
                'contribute/installation-store': resolve(__dirname, 'src/contribute/installation-store.ts'),
                'contribute/node': resolve(__dirname, 'src/contribute/node.ts'),
                'contribute/protocol': resolve(__dirname, 'src/contribute/protocol.ts'),
                'contribute/schema': resolve(__dirname, 'src/contribute/schema.ts'),
                'contribute/settings': resolve(__dirname, 'src/contribute/settings.ts'),
            },
            name: 'Fuse',
            formats: ['es', 'cjs'],
            fileName: (format, entry) => `${entry}.${format === 'es' ? 'mjs' : 'cjs'}`,
        },
        rollupOptions: {
            external: [
                /^@modelcontextprotocol\//,
                /^zod(?:\/|$)/,
                'fs',
                'path',
                'usb',
                'ink',
                'ink-spinner',
                'node:fs',
                'node:path',
                'node:stream',
                'node:process',
                'node:buffer',
                'node:events',
                'assert',
                'events',
                'module',
                /^node:/,
            ],
        },
    },
})
