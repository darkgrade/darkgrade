import type { Camera } from '@camera/index'
import { runCameraOperationCommand } from '@cli/camera-operation'
import { cameraCommandOperations, resolveCommand } from '@cli/commands'
import { runDarkgradeCli } from '@cli/index'
import { createTerminal } from '@cli/terminal'
import { surfaceOperation, surfaceOperations } from '@runtime/operations'
import { streams } from '@tests/fixtures/terminal-streams'
import { describe, expect, it } from 'vitest'

const flags = { noColor: true, noInput: true, noProgress: true, quiet: true }

/** A Camera stand-in that records each call; only the methods these tests reach exist. */
function fakeCamera(methods: Record<string, (...parameters: unknown[]) => Promise<unknown>>) {
    const calls: unknown[][] = []
    const all: Record<string, (...parameters: unknown[]) => Promise<unknown>> = {
        connect: async () => undefined,
        disconnect: async () => undefined,
        ...methods,
    }
    const recorded = Object.fromEntries(
        Object.entries(all).map(([name, method]) => [
            name,
            async (...parameters: unknown[]) => {
                calls.push([name, ...parameters])
                return method(...parameters)
            },
        ])
    )
    return { camera: recorded as unknown as Camera, calls }
}

describe('darkgrade camera commands', () => {
    it('are one kebab-case command per public operation, generated from Camera', () => {
        const expected = surfaceOperations()
            .filter(operation => !operation.static)
            .map(operation => operation.cliCommand.slice('darkgrade camera '.length))
        expect([...cameraCommandOperations.keys()].sort()).toEqual(expected.sort())
        for (const name of ['get-capabilities', 'set-control', 'set-iso', 'get-iso', 'set-shutter-speed', 'take-photo', 'connect',
            'start-recording', 'stop-recording', 'start-zoom', 'stop-zoom', 'zoom-to', 'nudge-focus', 'download-media', 'get-battery',
            'set-clock', 'recover'])
            expect(cameraCommandOperations.has(name)).toBe(true)
        // Library-only events (the CLI streams them with `watch`); discover stays the top-level `darkgrade cameras`.
        for (const name of ['on', 'off', 'discover', 'get-instance']) expect(cameraCommandOperations.has(name)).toBe(false)
        expect(resolveCommand(['camera', 'watch']).path.at(-1)?.name).toBe('watch')
        expect(resolveCommand(['camera', 'start-zoom']).path.at(-1)?.flags?.map(flag => flag.name)).toContain('duration')
        expect(resolveCommand(['camera', 'start-recording']).path.at(-1)?.flags?.map(flag => flag.name)).toEqual(['duration', 'camera', 'json'])
        expect(resolveCommand(['cameras']).path.at(-1)?.name).toBe('cameras')
        expect([...cameraCommandOperations.keys()].some(name => /sony|canon|nikon/.test(name))).toBe(false)
    })

    it('take required inputs as arguments and the rest as flags, refusing a bad value before opening a camera', async () => {
        const commands = resolveCommand(['camera', 'set-focus-point']).path.at(-1)
        expect(commands?.arguments?.map(argument => argument.name)).toEqual(['x', 'y'])
        expect(commands?.flags?.map(flag => flag.name)).toContain('no-autofocus')
        expect(resolveCommand(['camera', 'take-photo']).path.at(-1)?.flags?.map(flag => flag.name)).toEqual(
            expect.arrayContaining(['no-autofocus', 'destination', 'output', 'camera', 'json'])
        )
        for (const words of [
            ['camera', 'set-focus-point', '0.5'],
            ['camera', 'nudge-focus', 'in', 'small'],
            ['camera', 'take-photo', '--destination', 'memory'],
            ['camera', 'set-clock', '--moment', 'yesterday'],
            ['camera', 'set-iso'],
        ]) {
            const { value, written } = streams()
            expect(await runDarkgradeCli(words, { streams: value })).toBe(1)
            expect(written.error).toMatch(/Usage:/)
        }
    })

    it('run the same call as the library, write a returned file and close the camera', async () => {
        const { camera, calls } = fakeCamera({
            takePhoto: async () => ({ destination: 'computer', name: 'DSC00003.JPG', sizeBytes: 3, data: new Uint8Array([1, 2, 3]) }),
        })
        const files: [string, number][] = []
        const { value, written } = streams()
        const status = await runCameraOperationCommand(
            {
                operation: surfaceOperation('takePhoto')!,
                input: { autofocus: false, destination: 'computer' },
                camera: { vendorId: 0x054c, productId: 0x0f56 },
                outputPath: 'photo.jpg',
                json: true,
            },
            createTerminal(flags, value),
            {
                discover: async () => [],
                createCamera: async () => camera,
                writeFile: async (path, data) => void files.push([path, data.byteLength]),
                onStopRequest: () => () => undefined,
            }
        )
        expect(status).toBe(0)
        expect(calls).toEqual([['connect'], ['takePhoto', { autofocus: false, destination: 'computer' }], ['disconnect']])
        expect(files).toEqual([['photo.jpg', 3]])
        expect(JSON.parse(written.output)).toMatchObject({ result: { name: 'DSC00003.JPG', sizeBytes: 3, data: { file: 'DSC00003.JPG', bytes: 3 } }, files: [{ path: 'photo.jpg' }] })
    })

    it('keep the session open when a stop cannot be confirmed, and recover without connecting first', async () => {
        const stuck = fakeCamera({
            stopRecording: async () => {
                throw new Error('Stop was not confirmed')
            },
            getRecordingState: async () => 'recording',
        })
        const dependencies = (camera: Camera) => ({
            discover: async () => [],
            createCamera: async () => camera,
            writeFile: async () => undefined,
            onStopRequest: () => () => undefined,
        })
        const options = (name: string) => ({
            operation: surfaceOperation(name)!,
            input: {},
            camera: { vendorId: 0x04a9, productId: 0x32f5 },
            json: true,
        })
        await expect(runCameraOperationCommand(options('stopRecording'), createTerminal(flags, streams().value), dependencies(stuck.camera))).rejects.toThrow('not confirmed')
        expect(stuck.calls.map(call => call[0])).toEqual(['connect', 'stopRecording', 'getRecordingState'])
        const stopped = fakeCamera({ recover: async () => ({ recovered: true, steps: [] }) })
        expect(await runCameraOperationCommand(options('recover'), createTerminal(flags, streams().value), dependencies(stopped.camera))).toBe(0)
        expect(stopped.calls.map(call => call[0])).toEqual(['recover'])
    })

    it('hold start-zoom until the stop request, then stop once', async () => {
        const { camera, calls } = fakeCamera({ startZoom: async () => undefined, stopZoom: async () => undefined })
        let requestStop = () => {}
        const { value, written } = streams()
        const running = runCameraOperationCommand(
            {
                operation: surfaceOperation('startZoom')!,
                input: { direction: 'in', speed: 'slow' },
                camera: { vendorId: 0x054c, productId: 0x0f56 },
                json: true,
                hold: { stop: surfaceOperation('stopZoom')! },
            },
            createTerminal(flags, value),
            {
                discover: async () => [],
                createCamera: async () => camera,
                writeFile: async () => undefined,
                onStopRequest: request => ((requestStop = request), () => undefined),
            }
        )
        await new Promise(resolve => setTimeout(resolve, 10))
        expect(calls.map(call => call[0])).toEqual(['connect', 'startZoom'])
        requestStop()
        expect(await running).toBe(0)
        expect(calls).toEqual([['connect'], ['startZoom', 'in', { speed: 'slow' }], ['stopZoom'], ['disconnect']])
        expect(JSON.parse(written.output)).toBeNull()
    })
})
