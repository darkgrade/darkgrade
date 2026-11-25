import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'

/**
 * Reads the camera's identity and battery, and sets its clock to this computer's time (what Studio
 * does on every connection, so the camera is left as Studio would leave it).
 */
export const bodySmoke: SmokeArea = {
    name: 'body',
    description: 'getInfo, getBattery and setClock (to now)',
    async run(camera, report) {
        report.confirmed('getInfo', await camera.getInfo())
        report.confirmed('getBattery', await camera.getBattery())
        const availability = (await camera.getCapabilities()).operations
        report.confirmed('getCapabilities().operations', availability)
        if (availability?.setClock?.supported === false)
            return report.skipped('setClock', availability.setClock.reason ?? 'unavailable')
        const moment = new Date()
        await camera.setClock(moment)
        report.confirmed('setClock', { confirmedByCamera: true, localTime: moment.toString() })
    },
}
