import type { Camera } from '@camera/index'

export interface BenchmarkCheck {
    name: string
    passed: boolean
    durationMilliseconds: number
    error?: 'operation-failed'
}
/** Caller owns the connected camera. Default checks only read; capture/live require explicit selection. */
export async function runCameraBenchmark(camera: Camera, options: { capture?: boolean; live?: boolean } = {}) {
    const checks: BenchmarkCheck[] = []
    const check = async (name: string, work: () => Promise<unknown>) => {
        const start = performance.now()
        try {
            await work()
            checks.push({ name, passed: true, durationMilliseconds: Math.round(performance.now() - start) })
        } catch {
            checks.push({
                name,
                passed: false,
                durationMilliseconds: Math.round(performance.now() - start),
                error: 'operation-failed',
            })
        }
    }
    const instance = camera.getInstance()
    await check('identity', async () => {
        const response = await camera.send(instance.registry.operations.GetDeviceInfo, {})
        if (response.code !== 0x2001 || !response.data?.model) throw new Error('Missing camera identity')
    })
    await check('storage', async () => {
        const response = await camera.send(instance.registry.operations.GetStorageIDs, {})
        if (response.code !== 0x2001 || !response.data) throw new Error('Missing storage result')
    })
    await check('properties', async () => {
        if (!(await instance.getStandardPropertyStates()).length) throw new Error('No readable properties')
    })
    if (options.capture)
        await check('photo-transfer', async () => {
            const image = await camera.captureImage({ includeData: true, autofocus: false })
            if (!image.data?.length) throw new Error('No image transferred')
        })
    if (options.live)
        await check('live-transfer', async () => {
            const frame = await camera.captureLiveView({ includeData: true })
            if (!frame.data?.length) throw new Error('No frame transferred')
        })
    return { checks, passed: checks.every(result => result.passed), mediaDecoded: false }
}
