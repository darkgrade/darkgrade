import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Live view settings smoke steps; follow exposure.ts. Restore every value you change. */
export async function liveViewSettingsSmoke(_camera: Camera, report: SmokeReport) {
    report.skipped('live-view settings', 'no typed live view settings yet')
}
