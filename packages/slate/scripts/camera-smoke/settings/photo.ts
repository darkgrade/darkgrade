import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Photo settings smoke steps; follow exposure.ts. Restore every value you change. */
export async function photoSettingsSmoke(_camera: Camera, report: SmokeReport) {
    report.skipped('photo settings', 'no typed photo settings yet')
}
