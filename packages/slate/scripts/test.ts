// Vitest checks camera source, Bun checks runtime resolution, and Node checks built diagnostics.
// Arguments belong to Vitest; a full run also builds and tests the public runtime/diagnostics.
// Nothing here opens a camera: hardware tests need SLATE_HARDWARE_TESTS=1, which only
// `bun run camera:lease -- <command>` sets (see tests/setup/hardware.ts).
import { spawnSync } from 'node:child_process'
import { globSync } from 'node:fs'

const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
}
const filters = process.argv.slice(2)
if (!filters.length) run('bun', ['run', 'build'])
if (!filters.length) run('bun', ['run', 'scripts/check-guards.ts'])
run('vitest', ['run', ...filters])
if (!filters.length) {
    run('bun', ['test', './tests/runtime'])
    run('node', ['--test', ...globSync('tests/contribute/*.test.ts')])
    run('node', ['--test', ...globSync('tests/cli/*.test.ts')])
}
