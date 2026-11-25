import { describe, expect, test } from 'bun:test'
import { scanSecurityFile } from '../security-rules'

describe('Leak and workspace boundary checks', () => {
    test('rejects extra workspace packages while allowing existing product and infrastructure workspaces', () => {
        for (const file of ['packages/contribute/package.json', 'packages/runtime/package.json',
            'packages/telemetry/package.json', 'packages/ui/package.json', 'apps/new-product/package.json',
            'apps/contribution-collector/package.json', 'apps/telemetry/package.json',
            'apps/testbench/package.json', 'apps/example-web/package.json', 'packages/typescript-config/package.json',
            'apps/drkgrd.co/package.json', 'apps/studio/another-app/package.json'])
            expect(scanSecurityFile(file, '{}').map(f => f.rule)).toContain('unapproved-workspace-package')
        for (const file of ['packages/slate/package.json', 'packages/cli/package.json',
            'apps/studio/package.json',
            'apps/darkgrade.com/drkgrd.co/package.json'])
            expect(scanSecurityFile(file, '{}')).toEqual([])
    })
    test('finds credentials without returning their contents, including accidental test-file secrets', () => {
        const key = ['AK', 'IA', 'A'.repeat(16)].join('')
        const result = scanSecurityFile('packages/slate/tests/example.test.ts', `const key = "${key}"`)
        expect(result).toEqual([{ file: 'packages/slate/tests/example.test.ts', line: 1, rule: 'cloud-access-key' }])
        expect(JSON.stringify(result)).not.toContain(key)
    })
    test('rejects committed environment files but allows examples', () => {
        expect(scanSecurityFile('.env.local', 'anything').some(f => f.rule === 'tracked-environment-file')).toBe(true)
        expect(scanSecurityFile('apps/studio/.env.example', 'NAME=value')).toEqual([])
    })
})
