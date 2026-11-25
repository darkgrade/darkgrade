import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * macOS starts a system daemon the moment a PTP camera enumerates on USB, and that daemon claims
 * the device's Still Image interface, so claiming it from user space fails with
 * LIBUSB_ERROR_ACCESS or BUSY. The process name varies: `ptpcamerad` (current macOS),
 * `PTPCamera` (older macOS) and `mscamerad` (cameras in mass-storage mode).
 *
 * launchd respawns them, so one kill is not enough: Studio and `camera:lease` repeat it about
 * once a second for as long as they use the camera.
 */
export const macCameraDaemons = ['ptpcamerad', 'PTPCamera', 'mscamerad'] as const

/** Stops the macOS camera daemons that are running and returns the ones it stopped. */
export async function killMacCameraDaemons(): Promise<string[]> {
    if (process.platform !== 'darwin') return []
    const killed: string[] = []
    for (const processName of macCameraDaemons) {
        try {
            await execFileAsync('killall', ['-9', processName])
            killed.push(processName)
        } catch {
            // killall exits non-zero when no such process is running, which is the state we want.
        }
    }
    return killed
}
