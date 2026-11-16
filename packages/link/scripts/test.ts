// Link's tests run under two runners: Vitest for the camera library, Bun for the runtime, whose
// tests check package resolution with Bun's bundler. Arguments (file filters, flags) belong to
// Vitest; the runtime tests run with a full, unfiltered test run.
import { spawnSync } from 'node:child_process'

const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
}
const filters = process.argv.slice(2)
run('vitest', ['run', ...filters])
if (!filters.length) run('bun', ['run', 'test:runtime'])
