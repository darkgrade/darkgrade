import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { captureCameraProfile } from '@vendors/profile-capture'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argumentsValue = process.argv.slice(2)
const usage =
    'bun run bench:profile --camera VID:PID --output NEW_FILE [--serial SERIAL] [--initialize] [--live-view] [--max-properties 128] [--timeout-seconds 60]'
if (argumentsValue.includes('--help')) {
    process.stdout.write(usage + '\n')
    process.exit(0)
}
const argument = (name: string) => {
    const index = argumentsValue.indexOf(name)
    return index >= 0 ? argumentsValue[index + 1] : undefined
}
const identifier = argument('--camera')?.match(/^([0-9a-f]{4}):([0-9a-f]{4})$/i)
const output = argument('--output')
const qualifiedProperty = argument('--qualify-property')
const qualifiedValue = argument('--qualify-value')
if ((qualifiedProperty === undefined) !== (qualifiedValue === undefined)) throw new Error('Supply both qualification property and value')
if (!identifier || !output) throw new Error('Usage: ' + usage)
if (existsSync(resolve(output))) throw new Error('Choose a new output file; existing captures are never overwritten')
const timeoutSeconds = Number(argument('--timeout-seconds') ?? 60)
const logger = new Logger({ renderInTerminal: false, captureConsole: false, expanded: false })
const transport = new USBTransport(logger, { maxBulkReadBytes: 16_384 })
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dir, encoding: 'utf8' }).trim()
// USB discovery includes private device identities; this command prints only its sanitized summary.
console.log = () => undefined
const watchdog = setTimeout(
    () => {
        process.stderr.write('Profile capture exceeded its cleanup deadline; inspect bench health before retrying.\n')
        process.exit(124)
    },
    (timeoutSeconds + 15) * 1000
)
try {
    const report = await captureCameraProfile(transport, {
        vendorId: Number.parseInt(identifier[1], 16),
        productId: Number.parseInt(identifier[2], 16),
        serialNumber: argument('--serial'),
        revision,
        initialize: argumentsValue.includes('--initialize'),
        liveView: argumentsValue.includes('--live-view'),
        maxProperties: Number(argument('--max-properties') ?? 128),
        timeoutSeconds,
        onCheck: check => process.stderr.write(JSON.stringify({ profileCheck: check }) + '\n'),
        ...(qualifiedProperty && { qualify: { property: Number(qualifiedProperty), value: qualifiedValue! } }),
    })
    writeFileSync(resolve(output), JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
    process.stdout.write(
        JSON.stringify({
            output: resolve(output),
            device: report.device,
            checks: report.checks,
            transactions: report.transactions.length,
            observations: report.observations.length,
            skippedIncomplete: report.skippedIncomplete,
        }) + '\n'
    )
    process.exitCode = report.checks.some(check => check.id === 'device-info' && check.status === 'pass') ? 0 : 1
} finally {
    clearTimeout(watchdog)
}
