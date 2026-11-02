import { Logger } from '@core/logger'
import { USBTransport } from '@transport/usb/usb-transport'
import { createRecordingBundle } from '@transport/node-recording'
import { captureCameraProfile } from '@vendors/profile-capture'
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const argumentsValue = process.argv.slice(2)
const usage =
    'bun run bench:profile --camera VID:PID --output NEW_FILE [--serial SERIAL] [--initialize] [--live-view] [--take-photo --autofocus true|false] [--max-properties 128] [--timeout-seconds 60] [--recording-directory NEW_DIRECTORY]'
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
const dirty = execFileSync('git', ['diff', '--name-only', 'HEAD'], { cwd: import.meta.dir, encoding: 'utf8' }).trim().length > 0
const recordingDirectory = argument('--recording-directory')
if (argumentsValue.includes('--recording-directory') && (!recordingDirectory || recordingDirectory.startsWith('--')))
    throw new Error('--recording-directory requires a new directory path')
const takePhoto = argumentsValue.includes('--take-photo')
const autofocus = argument('--autofocus')
if (takePhoto && (!argumentsValue.includes('--initialize') || !['true', 'false'].includes(autofocus ?? '')))
    throw new Error('--take-photo requires --initialize and --autofocus true|false')
if (!takePhoto && autofocus !== undefined) throw new Error('--autofocus requires --take-photo')
const recording = recordingDirectory ? await createRecordingBundle(transport, resolve(recordingDirectory), {
    evidence: 'hardware', camera: identifier[0], firmware: 'unknown-before-probe', transport: 'usb',
    revision: revision + (dirty ? '+dirty' : ''), scenario: [
        'profile', ...(takePhoto ? [`still-autofocus-${autofocus}`] : []),
        ...(argumentsValue.includes('--live-view') ? ['live-view'] : []),
    ].join('-'),
    contributors: [{ name: 'Darkgrade test bench', role: 'hardware capture' }],
    sources: [`darkgrade/darkgrade@${revision}`],
    limitations: ['Private raw transport bytes may contain camera identity and image metadata. Not a physical USB bus capture.',
        'Transferred media requires separate independent decoding. Contributor identity and camera loans require separate attribution.'],
}) : undefined
let observed: { camera?: string; firmware?: string } | undefined
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
    const report = await captureCameraProfile(recording?.transport ?? transport, {
        vendorId: Number.parseInt(identifier[1], 16),
        productId: Number.parseInt(identifier[2], 16),
        serialNumber: argument('--serial'),
        revision,
        initialize: argumentsValue.includes('--initialize'),
        liveView: argumentsValue.includes('--live-view'),
        ...(takePhoto && { takePhoto: { autofocus: autofocus === 'true' } }),
        maxProperties: Number(argument('--max-properties') ?? 128),
        timeoutSeconds,
        onCheck: check => process.stderr.write(JSON.stringify({ profileCheck: check }) + '\n'),
        ...(qualifiedProperty && { qualify: { property: Number(qualifiedProperty), value: qualifiedValue! } }),
    })
    observed = { camera: report.device.model, firmware: report.device.firmware }
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
    const required = ['device-info', ...(takePhoto ? ['take-photo'] : []), ...(argumentsValue.includes('--live-view') ? ['live-view'] : [])]
    process.exitCode = required.every(id => report.checks.some(check => check.id === id && check.status === 'pass')) ? 0 : 1
} finally {
    clearTimeout(watchdog)
    if (recording) {
        const result = await recording.finish(observed)
        process.stderr.write(JSON.stringify({ privateRecording: result }) + '\n')
        if (!result.complete) process.exitCode = 1
    }
}
