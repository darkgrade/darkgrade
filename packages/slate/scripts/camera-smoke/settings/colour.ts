import type { Camera } from '@camera/index'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Colour settings smoke steps; follow exposure.ts. Restore every value you change. */
export async function colourSettingsSmoke(_camera: Camera, report: SmokeReport) {
    report.skipped('colour settings', 'no typed colour settings yet')
}
