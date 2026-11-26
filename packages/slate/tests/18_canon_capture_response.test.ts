import { CameraRefusedError } from '@camera/errors'
import { canonTestCamera } from '@tests/fixtures/canon-camera'
import { describe, expect, it, vi } from 'vitest'

type CannedResponse = number | { code: number; parameters?: number[] } | Error

function cameraWithResponses(responses: CannedResponse[]) {
    const { camera } = canonTestCamera()
    const operations: Array<{ name: string; params: unknown }> = []
    camera.send = (async (operation, params) => {
        operations.push({ name: operation.name, params })
        const response = responses.shift() ?? 0x2001
        if (response instanceof Error) throw response
        return typeof response === 'number' ? { code: response } : response
    }) as typeof camera.send
    return { camera, operations }
}

const manualFocusPress = { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'FOCUS', AFMode: 'MF' } }
const manualShutterPress = { name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'SHUTTER', AFMode: 'MF' } }
const shutterRelease = { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'SHUTTER' } }
const focusRelease = { name: 'CanonRemoteReleaseOff', params: { ReleaseMode: 'FOCUS' } }

describe('Canon capture response handling', () => {
    it.each([
        [true, 12, 'shutter result 0xc'],
        [false, 12, 'shutter result 0xc'],
        [false, 14, 'shutter result 0xe'],
        [false, 0, undefined],
    ] as const)('checks the shutter result despite PTP OK (autofocus=%s, result=%s)', async (autofocus, result, error) => {
        const {camera, operations} = cameraWithResponses([{code: 0x2001, parameters: [0]}, {code: 0x2001, parameters: [result]}])
        const capture = camera.captureImage({autofocus, includeInfo: false, includeData: false})
        if (error) await expect(capture).rejects.toThrow(error)
        else await expect(capture).resolves.toEqual({})
        expect(operations.map(operation => operation.name)).toEqual([
            'CanonRemoteReleaseOn', 'CanonRemoteReleaseOn', 'CanonRemoteReleaseOff', 'CanonRemoteReleaseOff',
        ])
        expect(operations.filter(operation => (operation.params as { ReleaseMode?: string }).ReleaseMode === 'SHUTTER')).toHaveLength(2)
    })

    it('releases an acknowledged half press with a rejected result without sending full press', async () => {
        const {camera, operations} = cameraWithResponses([{code: 0x2001, parameters: [1]}])
        await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow('focus press rejected capture')
        expect(operations.map(operation => operation.name)).toEqual(['CanonRemoteReleaseOn', 'CanonRemoteReleaseOff'])
    })

    it('explicit no-autofocus capture uses only MF release parameters without changing body focus mode', async () => {
        const { camera, operations } = cameraWithResponses([])
        const setFocusMode = vi.spyOn(camera, 'setFocusMode')
        await expect(camera.captureImage({ includeInfo: false, includeData: false, autofocus: false })).resolves.toEqual({})
        expect(operations).toEqual([manualFocusPress, manualShutterPress, shutterRelease, focusRelease])
        expect(setFocusMode).not.toHaveBeenCalled()
    })

    it.each([
        {
            failure: 'failed MF full press',
            autofocus: false,
            responses: [0x2001, 0x2019, 0x2001, 0x2001],
            error: 'MF shutter press returned 0x2019',
            expected: [manualFocusPress, manualShutterPress, shutterRelease, focusRelease],
        },
        {
            failure: 'failed MF focus press',
            autofocus: false,
            responses: [0x2019, 0x2001],
            error: 'MF focus press returned 0x2019',
            expected: [manualFocusPress, focusRelease],
        },
        {
            failure: 'MF shutter transport error whose cleanup also throws',
            autofocus: false,
            responses: [0x2001, new Error('Shutter transport failed'), new Error('Shutter transport failed'), 0x2001],
            error: 'Shutter transport failed',
            expected: [manualFocusPress, manualShutterPress, shutterRelease, focusRelease],
        },
        {
            failure: 'shutter cleanup failure',
            autofocus: false,
            responses: [0x2001, 0x2001, 0x2019, 0x2001],
            error: 'shutter cleanup failed',
            expected: [manualFocusPress, manualShutterPress, shutterRelease, focusRelease],
        },
        {
            failure: 'default AF focus press failure',
            autofocus: undefined,
            responses: [0x2019],
            error: 'AF focus press returned 0x2019',
            expected: [{ name: 'CanonRemoteReleaseOn', params: { ReleaseMode: 'FOCUS', AFMode: 'AF' } }],
        },
    ])('reports $failure, releases every attempted control and never falls back', async ({ autofocus, responses, error, expected }) => {
        const { camera, operations } = cameraWithResponses([...responses])
        await expect(camera.captureImage({ autofocus, includeInfo: false, includeData: false })).rejects.toThrow(error)
        expect(operations).toEqual(expected)
    })

    it('rejects invalid runtime autofocus flags before sending a capture command', async () => {
        const { camera, operations } = cameraWithResponses([])
        await expect(camera.captureImage({ autofocus: 0 as unknown as boolean })).rejects.toThrow('true or false')
        expect(operations).toEqual([])
    })

    it('does not repeat the shutter when AF rejection also fails cleanup', async () => {
        const { camera, operations } = cameraWithResponses([0x2001, 0x2019, 0x2019])
        await expect(camera.captureImage({ includeInfo: false, includeData: false })).rejects.toThrow(CameraRefusedError)
        expect(operations.filter(operation => operation.name === 'CanonRemoteReleaseOn')).toHaveLength(2)
    })

    it('reports a half press that could not focus as not acquired, releasing the acknowledged control', async () => {
        const { camera, operations } = cameraWithResponses([0x2005, { code: 0x2001, parameters: [1] }, 0x2001])
        await expect(camera.performAutofocus(0)).resolves.toBe('not-acquired')
        expect(operations.at(-1)?.name).toBe('CanonRemoteReleaseOff')
    })

    it('refuses with the EDSDK reason when a half press is rejected for another cause', async () => {
        const { camera, operations } = cameraWithResponses([0x2005, { code: 0x2001, parameters: [6] }, 0x2001])
        await expect(camera.performAutofocus(0)).rejects.toMatchObject({
            name: 'CameraRefusedError',
            message: expect.stringContaining('no card is inserted'),
        })
        expect(operations.at(-1)?.name).toBe('CanonRemoteReleaseOff')
    })
})
