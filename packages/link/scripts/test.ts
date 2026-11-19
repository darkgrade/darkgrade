// Vitest checks camera source, Bun checks runtime resolution, and Node checks built diagnostics.
// Arguments belong to Vitest; a full run also builds and tests the public runtime/diagnostics.
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'

const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
}
const filters = process.argv.slice(2)
run('vitest', ['run', ...filters])
if (!filters.length) {
    run('bun', ['run', 'test:runtime'])
    run('node', ['--test', ...globSync('tests/contribute/*.test.ts')])
}
