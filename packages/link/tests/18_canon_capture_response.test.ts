import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

function cameraWithResponses(responses: number[]) {
    const transport = {
        isLittleEndian: () => true,
        on: () => undefined,
    } as unknown as TransportInterface
    const camera = new CanonCamera(
        transport,
        new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
    )
    const operations: Array<{ name: string; params: unknown }> = []
    camera.send = (async (operation, params) => {
        operations.push({ name: operation.name, params })
        return { code: responses.shift() ?? 0x2001 }
    }) as typeof camera.send
    return { camera, operations }
}

describe('Canon capture response handling', () => {
    it('retries without autofocus after DeviceBusy and releases every pressed control', async () => {
        const { camera, operations } = cameraWithResponses([
            0x2001,
            0x2019,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
            0x2001,
        ])

        await expect(camera.captureImage({ includeInfo: false, includeData: false })).resolves.toEqual({})
        expect(operations.map(operation => operation.name)).toEqual([
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOff',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOff',
            'CanonRemoteReleaseOff',
        ])
        expect(operations[0]?.params).toEqual({ ReleaseMode: 'FOCUS', AFMode: 'AF' })
        expect(operations[3]?.params).toEqual({ ReleaseMode: 'FOCUS', AFMode: 'MF' })
    })

    it('releases shutter and focus after accepted capture commands', async () => {
        const { camera, operations } = cameraWithResponses([0x2001, 0x2001, 0x2001, 0x2001])

        await expect(camera.captureImage({ includeInfo: false, includeData: false })).resolves.toEqual({})
        expect(operations.map(operation => operation.name)).toEqual([
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOn',
            'CanonRemoteReleaseOff',
            'CanonRemoteReleaseOff',
        ])
    })
})
