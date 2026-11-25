import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'

/** The runner connects before and disconnects after every area; this reports the session itself. */
export const connectionSmoke: SmokeArea = {
    name: 'connection',
    description: 'connect, the identity the body reports, disconnect (read-only)',
    async run(camera, report) {
        const driver = camera.getInstance()
        report.confirmed('connect', { vendorId: driver.vendorId === null ? null : `0x${driver.vendorId.toString(16)}`, sessionId: driver.sessionId })
        const response = await camera.send(driver.registry.operations.GetDeviceInfo, {})
        if (response.code !== 0x2001 || !response.data) throw new Error(`GetDeviceInfo returned 0x${response.code.toString(16)}`)
        report.confirmed('GetDeviceInfo', {
            manufacturer: response.data.manufacturer,
            model: response.data.model,
            firmware: response.data.deviceVersion,
            operations: response.data.operationsSupportedRaw.length,
        })
    },
}
