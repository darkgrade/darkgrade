import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Video settings smoke steps; follow exposure.ts. Restore every value you change. */
export async function videoSettingsSmoke(_camera: Camera, report: SmokeReport) {
    report.skipped('video settings', 'no typed video settings yet')
}
