import { CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import { protocolSession } from '@camera/operations/protocol'
import type { SmokeArea } from '@scripts/camera-smoke/smoke-area'

const OK = 0x2001

/**
 * The runner connects before and disconnects after every area. This checks the identity the body
 * reports, then disconnect/connect({ observeOnly }) and recover/connect on the same Camera, and
 * leaves it connected normally for the next area. Read-only: no setting is written by these steps
 * beyond what connect() itself prepares.
 */
export const connectionSmoke: SmokeArea = {
    name: 'connection',
    description: 'discover, getInfo, observe-only reconnect, recover and reconnect on the same Camera (read-only)',
    async run(camera, report) {
        const information = await camera.getInfo()
        report.confirmed('getInfo', information)

        const session = protocolSession(camera)
        const response = await session.send(session.registry.operations.GetDeviceInfo, {})
        if (response.code !== OK || !response.data) throw new Error(`GetDeviceInfo returned 0x${response.code.toString(16)}`)
        if (response.data.model !== information.model || response.data.deviceVersion !== information.firmware)
            throw new Error('protocolSession GetDeviceInfo and getInfo disagree')
        report.confirmed('protocolSession GetDeviceInfo', {
            vendorId: session.vendorId === null ? null : hex(session.vendorId),
            operations: response.data.operationsSupportedRaw.length,
            properties: response.data.devicePropertiesSupported.length,
        })

        // A vendor property dump through /protocol; other vendors report it unsupported.
        const dump = await session.getSonyPropertyStates().then(
            states => ({ properties: states.length }),
            (error: unknown) => (error instanceof CameraUnsupportedError ? undefined : Promise.reject(error))
        )
        if (dump) report.confirmed('protocolSession getSonyPropertyStates', dump)
        else report.skipped('protocolSession getSonyPropertyStates', 'not a Sony body')

        const driver = session.driver
        await camera.disconnect()
        if (session.sessionId !== null) throw new Error('disconnect left a session open')
        report.confirmed('disconnect', { sessionId: session.sessionId })

        // Enumeration does not list a body this process holds open, so discover between sessions.
        const discovered = await Camera.discover()
        const listed = discovered.find(device => device.model === information.model)
        if (!listed) throw new Error(`Camera.discover did not list the ${information.model} after disconnect`)
        report.confirmed('Camera.discover', { vendorId: hex(listed.vendorId), productId: hex(listed.productId), model: listed.model })

        await camera.connect({ observeOnly: true })
        const observed = await camera.getInfo()
        if (observed.model !== information.model) throw new Error('observe-only reconnect reached another body')
        const capabilities = await camera.getCapabilities()
        report.confirmed('connect({ observeOnly: true }) on the same Camera', {
            sameDriver: session.driver === driver,
            sessionId: session.sessionId,
            controlsRead: Object.keys(capabilities.controls).length,
        })
        await camera.disconnect()

        // The deprecated Sony name is connect({ observeOnly: true }) behind a vendor check.
        const legacyObservation = await camera.connectSonyObservationSession().then(
            async () => ({ model: (await camera.getInfo()).model, sameDriver: session.driver === driver }),
            (error: unknown) => (error instanceof CameraUnsupportedError ? undefined : Promise.reject(error))
        )
        if (legacyObservation) {
            if (legacyObservation.model !== information.model) throw new Error('connectSonyObservationSession reached another body')
            report.confirmed('connectSonyObservationSession delegates to connect({ observeOnly: true })', legacyObservation)
            await camera.disconnect()
        } else report.skipped('connectSonyObservationSession', 'not a Sony body')

        const recovery = await camera.recover({ allowPortReset: false })
        if (!recovery.recovered) throw new Error(`recover did not prove the camera: ${JSON.stringify(recovery.steps)}`)
        report.confirmed('recover', {
            steps: recovery.steps.map(step => `${step.step}:${step.ok ? 'ok' : 'failed'}`),
            identity: recovery.identity,
            durationMilliseconds: recovery.durationMilliseconds,
        })

        await camera.connect()
        const reconnected = await camera.getInfo()
        if (reconnected.model !== information.model) throw new Error('reconnect after recover reached another body')
        report.confirmed('connect() after recover on the same Camera', { model: reconnected.model, sessionId: session.sessionId })
    },
}

const hex = (value: number) => `0x${value.toString(16).padStart(4, '0')}`
