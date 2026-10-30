import { CanonCamera } from '@camera/canon-camera'
import { Camera } from '@camera/index'
import { Logger } from '@core/logger'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it, vi } from 'vitest'

function cameraWithResponses(responses: Array<number | {code: number; parameters?: number[]}>) {
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
        const response = responses.shift() ?? 0x2001
        return typeof response === 'number' ? { code: response } : response
    }) as typeof camera.send
    return { camera, operations }
}

describe('Canon capture response handling', () => {
    it.each([[true, 12], [false, 12], [false, 14]] as const)('rejects a camera-side shutter failure despite PTP OK (autofocus=%s, result=%s)', async (autofocus, result) => {
        const {camera, operations} = cameraWithResponses([0x2001, {code: 0x2001, parameters: [result]}])
        await expect(camera.captureImage({autofocus, includeInfo: false, includeData: false})).rejects.toThrow(`shutter result 0x${result.toString(16)}`)
        expect(operations.map(operation => operation.name)).toEqual([
            'CanonRemoteReleaseOn', 'CanonRemoteReleaseOn', 'CanonRemoteReleaseOff', 'CanonRemoteReleaseOff',
        ])
        expect(operations.filter(operation => (operation.params as any).ReleaseMode === 'SHUTTER')).toHaveLength(2)
    })

    it('releases an acknowledged half press with a rejected result without sending full press', async () => {
        const {camera, operations} = cameraWithResponses([{code: 0x2001, parameters: [1]}])
        await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow('focus press rejected capture')
        expect(operations.map(operation => operation.name)).toEqual(['CanonRemoteReleaseOn', 'CanonRemoteReleaseOff'])
    })

    it('accepts explicit zero shutter results as well as legacy bodies omitting the result', async () => {
        const {camera} = cameraWithResponses([{code: 0x2001, parameters: [0]}, {code: 0x2001, parameters: [0]}])
        await expect(camera.captureImage({autofocus: false, includeInfo: false, includeData: false})).resolves.toEqual({})
    })
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
    it('explicit no-autofocus capture uses only MF release parameters without changing body focus mode', async () => {
        const { camera, operations } = cameraWithResponses([])
        const setFocusMode = vi.spyOn(camera, 'setFocusMode')
        await expect(camera.captureImage({ includeInfo: false, includeData: false, autofocus: false })).resolves.toEqual({})
        expect(operations).toEqual([
            { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'FOCUS', AFMode: 'MF' } },
            { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'SHUTTER', AFMode: 'MF' } },
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'SHUTTER' } },
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'FOCUS' } },
        ])
        expect(setFocusMode).not.toHaveBeenCalled()
    })

    it('checks failed MF full press and releases both attempted controls without AF fallback', async () => {
        const { camera, operations } = cameraWithResponses([0x2001, 0x2019, 0x2001, 0x2001])
        await expect(camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).rejects.toThrow('MF shutter press returned 0x2019')
        expect(operations).toEqual([
            { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'FOCUS', AFMode: 'MF' } },
            { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'SHUTTER', AFMode: 'MF' } },
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'SHUTTER' } },
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'FOCUS' } },
        ])
    })

    it('checks failed MF focus press and releases the attempted focus control', async () => {
        const { camera, operations } = cameraWithResponses([0x2019, 0x2001])
        await expect(camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).rejects.toThrow('MF focus press returned 0x2019')
        expect(operations).toEqual([
            { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'FOCUS', AFMode: 'MF' } },
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'FOCUS' } },
        ])
    })

    it('releases focus after an MF shutter transport error even when shutter cleanup also throws', async () => {
        const { camera, operations } = cameraWithResponses([])
        camera.send = (async (operation, params) => {
            operations.push({ name: operation.name, params })
            const release = params as { ReleaseMode?: string }
            if (release.ReleaseMode === 'SHUTTER') throw new Error('Shutter transport failed')
            return { code: 0x2001 }
        }) as typeof camera.send
        await expect(camera.captureImage({ autofocus: false, includeInfo: false, includeData: false })).rejects.toThrow('Shutter transport failed')
        expect(operations.slice(-2)).toEqual([
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'SHUTTER' } },
            { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'FOCUS' } },
        ])
        expect(operations.some(operation => (operation.params as any).AFMode === 'AF')).toBe(false)
    })

    it('default captures retain AF and do not hide AF focus-press failures', async () => {
        const { camera, operations } = cameraWithResponses([0x2019])
        await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow('AF focus press returned 0x2019')
        expect(operations).toEqual([{ name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'FOCUS', AFMode: 'AF' } }])
    })

    it('rejects invalid runtime autofocus flags before sending a capture command', async () => {
        const { camera, operations } = cameraWithResponses([])
        await expect(camera.captureImage({ autofocus: 0 as unknown as boolean })).rejects.toThrow('true or false')
        expect(operations).toEqual([])
    })

    it('reports shutter cleanup failure while still releasing focus', async () => {
        const { camera, operations } = cameraWithResponses([0x2001, 0x2001, 0x2019, 0x2001])
        await expect(camera.captureImage({ autofocus: false, includeInfo: false, includeData: false }))
            .rejects.toThrow('shutter cleanup failed')
        expect(operations.at(-1)?.params).toEqual({ ReleaseMode: 'FOCUS' })
        expect(operations.filter(operation => operation.name === 'CanonRemoteReleaseOn')).toHaveLength(2)
    })

    it('does not repeat the shutter when AF rejection also fails cleanup', async () => {
        const { camera, operations } = cameraWithResponses([0x2001, 0x2019, 0x2019])
        await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow(AggregateError)
        expect(operations.filter(operation => operation.name === 'CanonRemoteReleaseOn')).toHaveLength(2)
    })

    it('rejects an autofocus half press result while releasing the acknowledged control', async () => {
        const { camera, operations } = cameraWithResponses([0x2005, { code: 0x2001, parameters: [1] }, 0x2001])
        await expect(camera.autofocus(0)).rejects.toThrow('autofocus half press rejected')
        expect(operations.at(-1)?.name).toBe('CanonRemoteReleaseOff')
    })

    it('forwards the explicit no-autofocus option through the public Canon Camera API', async () => {
        const transport = { isLittleEndian: () => true, on: () => undefined } as unknown as TransportInterface
        const camera = new Camera({ vendorId: 0x04a9, transport, logger: { captureConsole: false, renderInTerminal: false } })
        const capture = vi.spyOn(camera.getInstance() as CanonCamera, 'captureImage').mockResolvedValue({})
        await camera.captureImage({ autofocus: false, includeData: false })
        expect(capture).toHaveBeenCalledWith({ includeInfo: true, includeData: false, autofocus: false })
    })

})
