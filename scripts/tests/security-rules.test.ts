import { describe, expect, test } from 'bun:test'
import { scanSecurityFile } from '../security-rules'

describe('Leak and migration checks', () => {
    test('rejects extra workspace packages while allowing existing product and infrastructure workspaces', () => {
        for (const file of ['packages/contribute/package.json', 'packages/runtime/package.json',
            'packages/telemetry/package.json', 'apps/new-product/package.json'])
            expect(scanSecurityFile(file, '{}').map(f => f.rule)).toContain('unapproved-workspace-package')
        for (const file of ['packages/slate/package.json', 'packages/cli/package.json',
            'apps/studio/package.json', 'apps/contribution-collector/package.json', 'packages/ui/package.json'])
            expect(scanSecurityFile(file, '{}')).toEqual([])
    })
    test('finds credentials without returning their contents, including accidental test-file secrets', () => {
        const key = ['AK', 'IA', 'A'.repeat(16)].join('')
        const result = scanSecurityFile('packages/slate/tests/example.test.ts', `const key = "${key}"`)
        expect(result).toEqual([{ file: 'packages/slate/tests/example.test.ts', line: 1, rule: 'cloud-access-key' }])
        expect(JSON.stringify(result)).not.toContain(key)
    })
    test('rejects vendor documents and private endpoints in a migration', () => {
        expect(scanSecurityFile('apps/testbench/vendor-document.pdf', '%PDF data').some(f => f.rule === 'non-ui-migration-material')).toBe(true)
        const host = ['demo', 'example', 'ts', 'net'].join('.')
        const email = ['person', 'example.invalid'].join('@')
        const data = scanSecurityFile('apps/testbench/MIGRATION.json', JSON.stringify({ host, email }))
        expect(data.map(f => f.rule)).toContain('network-address')
        expect(data.map(f => f.rule)).toContain('email-address')
        const address = ['fd00', '1234', '', '1'].join(':')
        expect(scanSecurityFile('apps/testbench/README.md', address).map(f => f.rule)).toContain('network-address')
    })
    test('does not treat required legal notices or package names as private material', () => {
        expect(scanSecurityFile('apps/testbench/README.md', 'Copyright Darkgrade Inc. Package @darkgrade/slate.')).toEqual([])
        expect(scanSecurityFile('apps/testbench/web/demo.css', 'figure::before { content: ""; } .field::after {}')).toEqual([])
    })
    test('rejects live browser capabilities even when a UI imports them accidentally', () => {
        for (const text of ["fetch('/controller')", "new WebSocket('/stream')",
            'navigator.usb.requestDevice({})', "import('hardware')", "import fs from 'node:fs'",
            "import { Camera } from '@darkgrade/slate'"])
            expect(scanSecurityFile('apps/testbench/src/app.ts', text).some(f => f.rule === 'browser-hardware-or-network-capability')).toBe(true)
    })
    test('permits generated UI and keeps capability checks scoped to the browser entry points', () => {
        expect(scanSecurityFile('apps/testbench/src/demo.ts', 'export const value = 100')).toEqual([])
        expect(scanSecurityFile('apps/testbench/tests/negative.test.ts', "fetch('/controller')")).toEqual([])
        expect(scanSecurityFile('.env.local', 'anything').some(f => f.rule === 'tracked-environment-file')).toBe(true)
    })
    test('allows the reviewed local API client but keeps native transports and other network clients out', () => {
        expect(scanSecurityFile('apps/testbench/src/live.ts', "fetch('/api/state')")).toEqual([])
        for (const text of ["import { Camera } from '@darkgrade/slate'", "new WebSocket('/stream')"])
            expect(scanSecurityFile('apps/testbench/src/live.ts', text).some(f => f.rule === 'browser-hardware-or-network-capability')).toBe(true)
    })
})
