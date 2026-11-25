import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Mode settings smoke steps; follow exposure.ts. Restore every value you change. */
export async function modeSettingsSmoke(_camera: Camera, report: SmokeReport) {
    report.skipped('mode settings', 'no typed mode settings yet')
}
