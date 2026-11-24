import { inspectRecording } from '@transport/recording-inspection'
import { recordingKeyFromEnvironment } from '@transport/recording-storage'
import { writeFile } from 'node:fs/promises'

const [directory, output] = process.argv.slice(2)
if (!directory || !output) throw new Error('Use bench:inspect-recording PRIVATE_DIRECTORY NEW_SUMMARY_FILE')
const key = process.env.DARKGRADE_RECORDING_KEY ? recordingKeyFromEnvironment() : undefined
const summary = await inspectRecording(directory, key ? { [key.id]: key.key } : undefined)
await writeFile(output, JSON.stringify(summary, null, 2), { flag: 'wx', mode: 0o600 })
console.log(
    JSON.stringify({
        complete: summary.complete,
        entries: summary.entries,
        failures: summary.failures,
        unframed: summary.unframed,
    })
)
