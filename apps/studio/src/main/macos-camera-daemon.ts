import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * macOS spawns a system daemon the moment a PTP camera enumerates on USB and
 * that daemon claims the device's Still Image interface, so any attempt to
 * claim it from user space fails with LIBUSB_ERROR_ACCESS / BUSY.
 * (See packages/link/tests/01_usb.test.ts: "Mac PTPCamera is running and
 * hijacking the USB device".)
 *
 * Process name varies by macOS version:
 *   - PTPCamera  (older macOS)
 *   - ptpcamerad (newer macOS)
 *   - mscamerad  (cameras in mass-storage mode)
 *
 * IMPORTANT: launchd respawns these continuously — a single kill is not
 * enough. macOS will clobber our access again within moments. The daemons
 * must be killed on a ~1 second loop for the entire app lifetime, which is
 * what startCameraDaemonKillerLoop does.
 */
const MACOS_CAMERA_DAEMONS = ['ptpcamerad', 'PTPCamera', 'mscamerad'] as const
const KILLER_INTERVAL_MS = 1000

export async function killMacCameraDaemons(): Promise<string[]> {
    if (process.platform !== 'darwin') return []

    const killed: string[] = []
    for (const processName of MACOS_CAMERA_DAEMONS) {
        try {
            await execFileAsync('killall', ['-9', processName])
            killed.push(processName)
        } catch {
            // "No matching processes" — daemon isn't running, which is what we want
        }
    }
    return killed
}

let killerTimer: ReturnType<typeof setInterval> | null = null

/** Kills the macOS camera daemons every second for the life of the app. */
export function startCameraDaemonKillerLoop(onKilled?: (processNames: string[]) => void): void {
    if (process.platform !== 'darwin' || killerTimer) return

    const tick = async (): Promise<void> => {
        const killed = await killMacCameraDaemons()
        if (killed.length > 0) onKilled?.(killed)
    }

    void tick()
    killerTimer = setInterval(() => void tick(), KILLER_INTERVAL_MS)
    killerTimer.unref?.()
}

export function stopCameraDaemonKillerLoop(): void {
    if (killerTimer) {
        clearInterval(killerTimer)
        killerTimer = null
    }
}
