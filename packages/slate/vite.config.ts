import { execFileSync } from 'node:child_process'
import { resolve } from 'path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import tsconfig from './tsconfig.json' with { type: 'json' }

export default defineConfig({
    define: {
        global: 'globalThis',
        __SLATE_TELEMETRY_REVISION__: JSON.stringify(
            process.env.SLATE_REVISION || execFileSync('git', ['rev-parse', 'HEAD']).toString().trim()
        ),
        __SLATE_TELEMETRY_DIRTY__: JSON.stringify(
            execFileSync('git', ['status', '--porcelain', '--untracked-files=no']).toString().trim().length > 0
        ),
    },
    plugins: [
        // Emits dist/index.d.ts (+ tree) with @camera/@core/... aliases
        // rewritten to relative paths so consumers can resolve them.
        dts({
            include: ['src'],
            exclude: ['src/telemetry/server/**'],
            entryRoot: 'src',
            compilerOptions: { stripInternal: true },
            beforeWriteFile(filePath, content) {
                // Every public entry serves NodeNext consumers, including the camera library.
                if (filePath.endsWith('.d.ts'))
                    content = content.replace(
                        /((?:from\s+|import\()['"])(\.[^'"]+)(['"])/g,
                        (_, prefix, path, quote) =>
                            `${prefix}${
                                /(?:^|\/)\.{1,2}$/.test(path)
                                    ? path + '/index.js'
                                    : /\.[cm]?[jt]s$/.test(path)
                                      ? path
                                      : path + '.js'
                            }${quote}`
                    )
                const cameraEntry =
                    (filePath.endsWith('/index.d.ts') && !/\/(?:cli|runtime|contribute)\//.test(filePath)) ||
                    /\/dist\/protocol\.d\.ts$/.test(filePath)
                if (cameraEntry)
                    content = '/// <reference types="w3c-web-usb" />\n' + content
                return { filePath, content }
            },
        }),
    ],
    resolve: {
        alias: Object.fromEntries(
            Object.entries(tsconfig.compilerOptions.paths).map(([name, [source]]) => [
                name.replace(/\/\*$/, ''),
                resolve(import.meta.dirname, source.replace(/\/\*$/, '')),
            ])
        ),
    },
    build: {
        lib: {
            // The camera library, and the shared runtime (operation ordering, leases, MCP tools)
            // that hosts embed. The runtime entries stay separate so a browser never loads
            // the Node-only lease coordinator or the USB stack.
            entry: {
                index: resolve(__dirname, 'src/index.ts'),
                controls: resolve(__dirname, 'src/controls.ts'),
                // Raw PTP access, vendor drivers and diagnostics, unsupported, for bench work.
                protocol: resolve(__dirname, 'src/protocol.ts'),
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
