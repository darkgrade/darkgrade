import { formatElapsed } from '@shared/format'
import { useEffect, useState } from 'react'

/** Counts up from when recording started, as a timecode-style clock. */
export function useRecordingClock(recording: boolean): string | null {
    const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!recording) {
            setStartedAtMs(null)
            return
        }
        setStartedAtMs(Date.now())
        const timer = setInterval(() => setTick(tick => tick + 1), 250)
        return () => clearInterval(timer)
    }, [recording])
    if (startedAtMs === null) return null
    return formatElapsed(Math.floor((Date.now() - startedAtMs) / 1000))
}
