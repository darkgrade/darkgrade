/** Camera telemetry only. A configured outlet or USB cable is not power-source evidence. */
export interface CameraPower {
    observedAt: string
    lastRefreshError?: string
    source: string
    percent?: number
    level?: 'empty' | 'low' | 'medium' | 'high' | 'full'
    powerSource: 'battery' | 'dc' | 'usb' | 'poe' | 'unknown'
    remainingMinutes?: number
    /** True only when explicitly reported; external power does not imply charging. */
    charging?: boolean
    batteryPresent?: boolean
    raw: Record<string, string | number>
}

export interface CameraPowerAssessment {
    status: 'pass' | 'warn' | 'fail'
    summary: string
    runtimeVerified: boolean
    reserveMinutes: number
}

/** Runtime is a camera estimate for current conditions, never derived from percentage. */
export function assessCameraPower(power: CameraPower | undefined, plannedMinutes: number, reserveMinutes = 5): CameraPowerAssessment {
    if (!Number.isFinite(plannedMinutes) || plannedMinutes <= 0 || !Number.isFinite(reserveMinutes) || reserveMinutes < 0) throw new Error('Expected positive planned minutes and a non-negative reserve')
    const result = (status: CameraPowerAssessment['status'], summary: string, runtimeVerified = false) => ({ status, summary, runtimeVerified, reserveMinutes })
    if (!power || power.lastRefreshError || !Number.isFinite(Date.parse(power.observedAt)) || Date.now() - Date.parse(power.observedAt) > 120_000 || Date.parse(power.observedAt) > Date.now() + 5000) return result('warn', 'Battery needs a fresh reading')
    if (power.percent === 0 || power.level === 'empty') return result('fail', 'Battery is empty · connect power before recording')
    if (power.percent !== undefined && power.percent <= 10 || power.level === 'low') return result('fail', 'Battery is critically low · replace it or connect power')
    const minutes = power.remainingMinutes
    if (minutes !== undefined && Number.isFinite(minutes) && minutes >= 0) {
        if (minutes < plannedMinutes) return result('fail', `${minutes} min battery remaining · need ${plannedMinutes} min`)
        if (minutes < plannedMinutes + reserveMinutes) return result('warn', `${minutes} min battery remaining · less than ${reserveMinutes} min spare`)
        return result('pass', `Camera estimates ${minutes} min battery · ${reserveMinutes} min reserve covered`, true)
    }
    if (power.percent !== undefined && power.percent <= 25) return result('warn', `${power.percent}% battery · runtime not reported`)
    if (power.powerSource !== 'battery' && power.powerSource !== 'unknown') return result('warn', `Camera reports ${power.powerSource.toUpperCase()} power · backup runtime not reported`)
    if (power.percent !== undefined) return result('warn', `${power.percent}% battery · runtime not reported`)
    if (power.level) return result('warn', `Battery ${power.level} · runtime not reported`)
    return result('warn', 'Battery level and runtime not reported')
}
