/**
 * Opens the compatibility UI on http://127.0.0.1:4174/.
 *
 *   bun run compat:ui [-- --port 4174 --host 127.0.0.1 --results <matrix.json|run.jsonl> ...]
 *
 * It shows the latest simulation, hardware and merged results, follows runs in progress live
 * (`bun run test:simulation` or `bun run compat:hardware` in another terminal, or its Run button),
 * and can open any past run log or matrix file.
 */
import { CompatData } from '@scripts/compat-ui/compat-data'
import { startCompatServer } from '@scripts/compat-ui/compat-server'

const argumentsList = process.argv.slice(2)
const valueAfter = (flag: string) => {
    const index = argumentsList.indexOf(flag)
    return index >= 0 ? argumentsList[index + 1] : undefined
}
const results = argumentsList.flatMap((argument, index) =>
    argument === '--results' && argumentsList[index + 1] ? [argumentsList[index + 1]] : []
)
const port = Number(valueAfter('--port') ?? process.env.COMPAT_UI_PORT ?? 4174)
const host = valueAfter('--host') ?? '127.0.0.1'

const running = await startCompatServer({ host, port, data: new CompatData({ extraResults: results }) })
console.log(`Camera compatibility UI: ${running.url}`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
        void running.close().then(() => process.exit(0))
    })
}
