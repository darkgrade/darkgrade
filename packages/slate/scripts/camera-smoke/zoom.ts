import { CameraUnsupportedError } from '@camera/errors'
import type { Camera } from '@camera/index'
import type { DigitalZoom } from '@camera/settings/video'
import type { SmokeArea, SmokeReport } from '@scripts/camera-smoke/smoke-area'

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

/** Reads digital zoom and, when the camera lets it change, sets another advertised value and restores it. */
async function digitalZoom(camera: Camera, report: SmokeReport) {
    let original: DigitalZoom
    try {
        original = await camera.getDigitalZoom()
    } catch (error) {
        if (error instanceof CameraUnsupportedError) return report.skipped('getDigitalZoom', error.message)
        throw error
    }
    report.confirmed('getDigitalZoom', original)
    const control = (await camera.getCapabilities()).controls.digitalZoom
    const alternative = control?.allowedValues?.find(value => value !== original)
    if (!control?.writable || !alternative)
        return report.skipped('setDigitalZoom', 'the camera does not let digital zoom change in its current mode')
    const changed = await camera.setControl('digitalZoom', alternative)
    report.confirmed(`setControl('digitalZoom', ${JSON.stringify(alternative)})`, changed.value)
    const restored = await camera.setDigitalZoom(original)
    report.confirmed(`setDigitalZoom(${JSON.stringify(original)})`, restored)
    if (restored !== original) throw new Error(`Digital zoom restored to ${restored}, not ${original}`)
}

/** Holds the zoom for a moment, stops it, then returns the lens to where it was with zoomTo. */
async function driveZoom(camera: Camera, report: SmokeReport, startFocalLength: number | null) {
    await camera.startZoom('in', { speed: 'slow' })
    report.confirmed("startZoom('in', { speed: 'slow' })", 'accepted')
    await wait(400)
    await camera.stopZoom()
    const moved = (await camera.getCapabilities()).lens?.focalLengthMillimetres ?? null
    report.confirmed('stopZoom after 400 ms', { from: startFocalLength, to: moved })
    if (startFocalLength === null) return report.skipped('zoomTo', 'the lens does not report its focal length')
    const landed = await camera.zoomTo(startFocalLength)
    report.confirmed(`zoomTo(${startFocalLength})`, `landed at ${landed} mm`)
}

export const zoomSmoke: SmokeArea = {
    name: 'zoom',
    description: 'getCapabilities().lens and zoom support, stopZoom, startZoom/zoomTo where offered, digitalZoom',
    async run(camera, report) {
        const capabilities = await camera.getCapabilities()
        report.confirmed('getCapabilities().lens', capabilities.lens ?? 'not reported')
        const operations = capabilities.operations ?? {}
        report.confirmed('getCapabilities().operations (zoom)', {
            zoomTo: operations.zoomTo,
            startZoom: operations.startZoom,
            stopZoom: operations.stopZoom,
        })
        await camera.stopZoom()
        report.confirmed('stopZoom with nothing moving', 'resolved (always allowed)')
        if (operations.startZoom?.supported)
            await driveZoom(camera, report, capabilities.lens?.focalLengthMillimetres ?? null)
        else {
            const refused = await camera.startZoom('in', { speed: 'slow' }).catch(error => error)
            if (!(refused instanceof CameraUnsupportedError))
                throw new Error(
                    `startZoom on an unsupported camera did not report CameraUnsupportedError: ${String(refused)}`
                )
            report.skipped('startZoom and zoomTo', refused.message)
        }
        await digitalZoom(camera, report)
    },
}
