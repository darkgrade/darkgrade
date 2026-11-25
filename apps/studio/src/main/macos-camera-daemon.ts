import { killMacCameraDaemons } from '@darkgrade/slate/runtime'

export { killMacCameraDaemons }

/*
 * macOS spawns a system daemon (ptpcamerad, PTPCamera or mscamerad) the moment a PTP camera
 * enumerates on USB, and it claims the Still Image interface. Slate owns the list and the kill
 * (`killMacCameraDaemons`, shared with `camera:lease`). launchd respawns the daemons
 * continuously, so Studio repeats the kill on a ~1 second loop for the entire app lifetime.
 */
const KILLER_INTERVAL_MS = 1000

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
