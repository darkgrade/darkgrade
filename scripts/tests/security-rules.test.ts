import { describe, expect, test } from 'bun:test'
import { scanSecurityFile } from '../security-rules'

describe('Leak and migration checks', () => {
    test('finds credentials without returning their contents, including accidental test-file secrets', () => {
        const key = ['AK', 'IA', 'A'.repeat(16)].join('')
        const result = scanSecurityFile('packages/link/tests/example.test.ts', `const key = "${key}"`)
        expect(result).toEqual([{ file: 'packages/link/tests/example.test.ts', line: 1, rule: 'cloud-access-key' }])
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
        expect(scanSecurityFile('apps/testbench/README.md', 'Copyright Darkgrade Inc. Package @darkgrade/link.')).toEqual([])
        expect(scanSecurityFile('apps/testbench/web/demo.css', 'figure::before { content: ""; } .field::after {}')).toEqual([])
    })
    test('rejects live browser capabilities even when a UI imports them accidentally', () => {
        for (const text of ["fetch('/controller')", "new WebSocket('/stream')",
            'navigator.usb.requestDevice({})', "import('hardware')", "import fs from 'node:fs'",
            "import { Camera } from '@darkgrade/link'"])
            expect(scanSecurityFile('apps/testbench/src/app.ts', text).some(f => f.rule === 'browser-hardware-or-network-capability')).toBe(true)
    })
    test('permits generated UI and keeps capability checks scoped to the browser entry points', () => {
        expect(scanSecurityFile('apps/testbench/src/demo.ts', 'export const value = 100')).toEqual([])
        expect(scanSecurityFile('apps/testbench/tests/negative.test.ts', "fetch('/controller')")).toEqual([])
        expect(scanSecurityFile('.env.local', 'anything').some(f => f.rule === 'tracked-environment-file')).toBe(true)
    })
})
