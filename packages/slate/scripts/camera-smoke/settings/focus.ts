import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Focus settings smoke steps; follow exposure.ts. Restore every value you change. */
export async function focusSettingsSmoke(_camera: Camera, report: SmokeReport) {
    report.skipped('focus settings', 'no typed focus settings yet')
}
