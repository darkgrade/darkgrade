import type { CameraRecordingState } from '@camera/controls'
import { CameraConfirmationError } from '@camera/confirmation'
import {
    parseCameraId,
    parseRecordingDuration,
    runStartRecordingCommand,
    type RecordingCamera,
    type StartRecordingDependencies,
} from '@cli/recording'
import { resolveCommand } from '@cli/commands'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.useRealTimers())

const sony = { vendorId: 0x054c, productId: 0x0f56, model: 'ILCE-7M5' }

/** A camera that records when told to; the CLI only uses the generic recording operations. */
function harness() {
    let state: CameraRecordingState = 'idle'
    const calls: string[] = []
    const camera = {
        connect: vi.fn(async () => {
            calls.push('connect')
        }),
        disconnect: vi.fn(async () => {
            calls.push('disconnect')
        }),
        startRecording: vi.fn(async () => {
            calls.push('start')
            state = 'recording'
        }),
        stopRecording: vi.fn(async () => {
            calls.push('stop')
            state = 'idle'
            return { mediaId: '2', name: 'C0002.MP4', sizeBytes: 12_000_000 }
        }),
        getRecordingState: vi.fn(async () => state),
    } satisfies RecordingCamera
    const printed: string[] = []
    const progress: string[] = []
    let stop: () => void = () => {}
    const dependencies: StartRecordingDependencies = {
        discover: async () => [sony],
        createCamera: async () => camera,
        print: line => printed.push(line),
        progress: line => progress.push(line),
        onStopRequest(request) {
            stop = request
            return () => (stop = () => {})
        },
    }
    return { camera, calls, printed, progress, dependencies, interrupt: () => stop(), setState: (next: CameraRecordingState) => (state = next) }
}

describe('darkgrade camera start-recording', () => {
    it('is named and described by the operation table', () => {
        const { path, remaining } = resolveCommand(['camera', 'start-recording'])
        expect(remaining).toEqual([])
        const command = path.at(-1)!
        expect(command.name).toBe('start-recording')
        expect(command.summary).toMatch(/Gets the camera ready/)
        expect(command.flags?.map(flag => flag.name)).toEqual(['duration', 'camera', 'json'])
    })

    it('reads durations people type and refuses ones it cannot honour', () => {
        expect(parseRecordingDuration('10s')).toBe(10_000)
        expect(parseRecordingDuration('1.5s')).toBe(1500)
        expect(parseRecordingDuration('2m')).toBe(120_000)
        expect(parseRecordingDuration('30')).toBe(30_000)
        for (const invalid of ['0s', '500ms', 'ten', '25h', '-1s']) expect(() => parseRecordingDuration(invalid)).toThrow()
        expect(parseCameraId('054C:0F56')).toEqual({ vendorId: 0x054c, productId: 0x0f56 })
        expect(() => parseCameraId('sony')).toThrow()
    })

    it('records in the foreground for --duration, then stops once and prints the clip', async () => {
        vi.useFakeTimers()
        const run = harness()
        const result = runStartRecordingCommand({ durationMilliseconds: 10_000, json: false }, run.dependencies)
        await vi.advanceTimersByTimeAsync(9_000)
        expect(run.calls).toEqual(['connect', 'start'])
        await vi.advanceTimersByTimeAsync(1_000)
        expect(await result).toBe(0)
        expect(run.calls).toEqual(['connect', 'start', 'stop', 'disconnect'])
        expect(run.printed).toEqual(['Stopped. C0002.MP4 (12.0 MB) is on the card.'])
    })

    it('stops on Ctrl-C and prints JSON when asked', async () => {
        const run = harness()
        const result = runStartRecordingCommand({ json: true }, run.dependencies)
        await vi.waitFor(() => expect(run.calls).toEqual(['connect', 'start']))
        run.interrupt()
        expect(await result).toBe(0)
        expect(JSON.parse(run.printed[0]!)).toEqual({ stopped: true, clip: { mediaId: '2', name: 'C0002.MP4', sizeBytes: 12_000_000 } })
    })

    it('keeps the session open, and says so, when Stop cannot be confirmed', async () => {
        const run = harness()
        run.camera.stopRecording.mockRejectedValue(new CameraConfirmationError('record_stop', 'idle', 'recording'))
        const result = runStartRecordingCommand({ json: false }, run.dependencies)
        await vi.waitFor(() => expect(run.calls).toEqual(['connect', 'start']))
        run.interrupt()
        expect(await result).toBe(1)
        expect(run.camera.disconnect).not.toHaveBeenCalled()
        expect(run.printed[0]).toMatch(/Stop was not confirmed.*reports recording/)
    })

    it('sends Stop at once after a Record the camera may have acted on, and exits nonzero', async () => {
        const run = harness()
        run.camera.startRecording.mockImplementation(async () => {
            run.calls.push('start')
            run.setState('unknown')
            throw new CameraConfirmationError('record_start', 'recording', 'unknown')
        })
        // No Ctrl-C and no --duration: the unconfirmed start alone sends Stop.
        expect(await runStartRecordingCommand({ json: true }, run.dependencies)).toBe(1)
        expect(run.calls).toEqual(['connect', 'start', 'stop', 'disconnect'])
        expect(run.progress.some(line => line.startsWith('Recording'))).toBe(false)
        expect(JSON.parse(run.printed[0]!)).toMatchObject({ stopped: true, startConfirmed: false, clip: { name: 'C0002.MP4' } })
    })

    it('sends Stop at once after an unconfirmed Record even with --duration', async () => {
        vi.useFakeTimers()
        const run = harness()
        run.camera.startRecording.mockRejectedValue(new CameraConfirmationError('record_start', 'recording', 'unknown'))
        run.setState('unknown')
        const result = runStartRecordingCommand({ durationMilliseconds: 60_000, json: false }, run.dependencies)
        await vi.advanceTimersByTimeAsync(10)
        expect(await result).toBe(1)
        expect(run.camera.stopRecording).toHaveBeenCalledOnce()
        expect(run.printed[0]).toMatch(/Record was not confirmed/)
    })

    it('reports a refused Record and closes the session without sending Stop', async () => {
        const run = harness()
        run.camera.startRecording.mockRejectedValue(new Error('No movie recording time remains'))
        await expect(runStartRecordingCommand({ json: false }, run.dependencies)).rejects.toThrow('No movie recording time')
        expect(run.camera.stopRecording).not.toHaveBeenCalled()
        expect(run.camera.disconnect).toHaveBeenCalledOnce()
    })
})
