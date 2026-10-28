/**
 * Turns what you record during standalone testing into profile and matrix data, filling "no data"
 * cells without the device lab.
 *
 *   bun run compat:ingest -- --capture nikon-z6-iii=~/captures/z6iii-connect.pcapng[@bus:address]
 *   bun run compat:ingest -- --capture canon-canon-eos-r5=r5.pcapng --simulate
 *   bun run compat:ingest -- --results ~/Downloads/20261028T150106Z-hardware-4242.jsonl
 *
 * --capture <profile id>=<file>: a usbmon pcapng/pcap capture. A committed captured profile is
 *   extended in place; a per-model mock id (as listed in the UI) starts a new captured profile under
 *   camera-profiles/<manufacturer>/<line>/ with the catalog identity and only the captured evidence.
 * --results <file>: a run log (*.jsonl) or support matrix (*.json) from a standalone hardware run, for
 *   example from another machine. Hardware rows become test-results/camera-lab/<profile>.json and the
 *   log is copied to test-results/compat-runs/ so the UI shows it in the camera's history.
 * --simulate: re-runs the simulation suite for the captured profiles afterwards (a filtered run; the
 *   full matrix is not replaced).
 * The merged compatibility matrix is refreshed at the end unless --no-merge is given.
 */
import { packageDirectory } from '@scripts/camera-profiles/compat-progress'
import { loadProfileIndex } from '@scripts/camera-profiles/profile-index'
import { refreshMergedMatrix } from '@scripts/camera-profiles/refresh-matrices'
import { ingestCapture, ingestResults } from '@scripts/camera-profiles/standalone-ingest'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import path from 'node:path'

const argumentsList = process.argv.slice(2)
const expandHome = (file: string) => (file.startsWith('~/') ? path.join(homedir(), file.slice(2)) : file)
const repeated = (flag: string) =>
    argumentsList.flatMap((argument, index) => (argument === flag ? [argumentsList[index + 1] ?? ''] : []))

const captures = repeated('--capture')
const results = repeated('--results')
if (!captures.length && !results.length) {
    console.error('Pass --capture <profile-id>=<file.pcapng> and/or --results <run.jsonl|matrix.json>.')
    process.exit(2)
}

const index = loadProfileIndex()
const captured: string[] = []
for (const capture of captures) {
    const match = capture.match(/^([a-z0-9-]+)=(.+?)(?:@(\d+):(\d+))?$/)
    if (!match) throw new Error(`Invalid --capture ${capture}; expected profile-id=file[@bus:address]`)
    const [, profileId, file, bus, address] = match
    const result = await ingestCapture(profileId, expandHome(file), {
        index,
        ...(bus && { address: { bus: Number(bus), address: Number(address) } }),
    })
    if (result.reportedModel && !result.profile.model.toLowerCase().includes(result.reportedModel.toLowerCase())) {
        console.warn(
            `Note: the capture's DeviceInfo reports "${result.reportedModel}"; the profile is "${result.profile.model}".`
        )
    }
    console.log(`Wrote ${path.relative(process.cwd(), result.file)}`)
    captured.push(result.profile.id)
}
for (const file of results) {
    const { rows, written } = ingestResults(expandHome(file))
    for (const output of written) console.log(`Wrote ${path.relative(process.cwd(), output)}`)
    if (!rows.length) console.log(`${path.basename(file)} has no hardware rows; it is kept for the UI only.`)
}

if (captured.length && argumentsList.includes('--simulate')) {
    const run = spawnSync(
        process.execPath,
        ['x', 'vitest', 'run', 'tests/camera-simulation/camera-compatibility.test.ts'],
        {
            cwd: packageDirectory,
            stdio: 'inherit',
            env: { ...process.env, COMPAT_ONLY: `profile=${captured.join(',')}` },
        }
    )
    if (run.status !== 0) process.exitCode = 1
}
if (!argumentsList.includes('--no-merge')) refreshMergedMatrix()
