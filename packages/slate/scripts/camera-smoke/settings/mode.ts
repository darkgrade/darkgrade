import type { Camera } from '@camera/index'
import type { PhotoVideoMode } from '@camera/settings/mode'
import { changeAndRestore } from '@scripts/camera-smoke/settings/colour'
import type { SmokeReport } from '@scripts/camera-smoke/smoke-area'

/** Mode settings smoke steps: drive mode, then photo/video and back, each restored. */
export async function modeSettingsSmoke(camera: Camera, report: SmokeReport) {
    await changeAndRestore(camera, report, {
        id: 'driveMode',
        get: () => camera.getDriveMode(),
        set: value => camera.setDriveMode(value),
        parse: choice => choice as Awaited<ReturnType<Camera['getDriveMode']>>,
        preferred: ['Continuous low', 'Continuous', 'Single'],
        // Never leave a self-timer or bracket armed if a restore were to fail.
        avoid: /timer|bracket|remote|portrait/i,
    })
    await changeAndRestore<PhotoVideoMode>(camera, report, {
        id: 'photoVideoMode',
        get: () => camera.getPhotoVideoMode(),
        set: value => camera.setPhotoVideoMode(value),
        parse: choice => (choice === 'video' ? 'video' : 'photo'),
    })
    const program = (await camera.getCapabilities()).controls.exposureProgram?.value
    if (program !== undefined) report.confirmed('exposure program after photo/video restore', program)
}
