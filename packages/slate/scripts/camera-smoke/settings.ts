import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'
import { exposureSettingsSmoke } from '@scripts/camera-smoke/settings/exposure'
import { modeSettingsSmoke } from '@scripts/camera-smoke/settings/mode'
import { colourSettingsSmoke } from '@scripts/camera-smoke/settings/colour'
import { focusSettingsSmoke } from '@scripts/camera-smoke/settings/focus'
import { photoSettingsSmoke } from '@scripts/camera-smoke/settings/photo'
import { videoSettingsSmoke } from '@scripts/camera-smoke/settings/video'
import { liveViewSettingsSmoke } from '@scripts/camera-smoke/settings/live-view'

/** One file per settings group under settings/, so each group's slice edits only its own. */
const groups = [
    exposureSettingsSmoke,
    modeSettingsSmoke,
    colourSettingsSmoke,
    focusSettingsSmoke,
    photoSettingsSmoke,
    videoSettingsSmoke,
    liveViewSettingsSmoke,
]

export const settingsSmoke: SmokeArea = {
    name: 'settings',
    description: 'getCapabilities and the typed settings (shutterSpeed so far), restoring each value',
    async run(camera, report) {
        const capabilities = await camera.getCapabilities()
        report.confirmed('getCapabilities', {
            controls: Object.keys(capabilities.controls),
            advertisedOperations: capabilities.advertisedOperations?.length ?? null,
        })
        for (const group of groups) await group(camera, report)
    },
}
