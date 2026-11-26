import { CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import { protocolSession } from '@camera/protocol-session'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

beforeEach(() => {
    vi.useFakeTimers()
})
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const transport = () =>
    ({ isLittleEndian: () => true, isConnected: () => true, on: () => undefined }) as unknown as TransportInterface

/**
 * A Canon driver whose FixedMovie readback follows its movie-select commands. `selector` decides
 * what a command does: apply at once, apply after a few event polls, or be ignored.
 */
function canon(options: { movie?: boolean; selector?: 'applies' | 'delayed' | 'ignored' } = {}) {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const order: string[] = []
    const phases: string[] = []
    let movie = options.movie ? 1 : 0
    let pending: number | undefined
    let polls = 0
    const select = (value: number) => {
        if (options.selector === 'ignored') return
        if (options.selector === 'delayed') pending = value
        else movie = value
    }
    driver['unknownPropertyCache'].set(0xd1c2, { get rawValue() { return movie } })
    vi.spyOn(driver, 'listPropertyStates').mockReturnValue([
        { code: 0xd105, name: 'CanonAutoExposureMode', description: '', access: 'GetSet', value: 1 },
    ])
    vi.spyOn(driver, 'refreshEventProperties').mockImplementation(async () => {
        if (pending !== undefined && ++polls >= 3) [movie, pending, polls] = [pending, undefined, 0]
    })
    const enter = vi.spyOn(driver, 'enterMovieMode').mockImplementation(async () => {
        order.push('movie on')
        select(1)
    })
    const leave = vi.spyOn(driver, 'leaveMovieMode').mockImplementation(async () => {
        order.push('movie off')
        select(0)
    })
    const destination = vi.spyOn(driver, 'prepareRecordingDestination').mockImplementation(async () => {
        order.push('card')
        return async () => {
            order.push('restore destination')
        }
    })
    vi.spyOn(driver, 'recordStateSnapshot').mockImplementation((_workflow, phase) => {
        phases.push(phase)
    })
    const openMovieMode = () => driver['openMovieMode']()
    return { driver, order, phases, enter, leave, destination, openMovieMode, movie: () => movie }
}

async function settled<Result>(work: Promise<Result>): Promise<Result> {
    const outcome = work.then(
        value => ({ value }),
        error => ({ error })
    )
    await vi.runAllTimersAsync()
    const result = await outcome
    if ('error' in result) throw result.error
    return result.value
}

it('prepares the card before movie selection and restores it only after leaving movie mode', async () => {
    const body = canon()
    const restore = await settled(body.openMovieMode())
    expect(body.order).toEqual(['card', 'movie on'])
    await settled(restore())
    expect(body.order).toEqual(['card', 'movie on', 'movie off', 'restore destination'])
    expect(body.phases).toEqual(['before-prepare', 'after-prepare', 'after-cleanup'])
})

it('leaves a body already in movie mode in it', async () => {
    const body = canon({ movie: true })
    const restore = await settled(body.openMovieMode())
    await settled(restore())
    expect(body.order).toEqual(['card', 'restore destination'])
})

it('restores card routing when movie selection fails before a recording starts', async () => {
    const body = canon()
    body.enter.mockRejectedValue(new Error('mode refused'))
    await expect(settled(body.openMovieMode())).rejects.toThrow('mode refused')
    expect(body.order).toEqual(['card', 'restore destination'])
    expect(body.phases).toEqual(['before-prepare', 'failure', 'after-cleanup'])
})

it.each(['delayed', 'ignored'] as const)('requires observed movie mode after an acknowledged %s selector', async selector => {
    const body = canon({ selector })
    const opening = settled(body.openMovieMode())
    if (selector === 'ignored') {
        await expect(opening).rejects.toThrow('did not confirm Movie')
        expect(body.order).toEqual(['card', 'movie on', 'movie off', 'restore destination'])
    } else {
        await settled((await opening)())
        expect(body.movie()).toBe(0)
    }
    expect(body.enter).toHaveBeenCalledTimes(1)
})

it.each([false, true])('restores movie mode after a photo (capture fails: %s)', async failure => {
    const body = canon({ movie: true })
    const capture = vi.fn(async () => {
        expect(body.movie()).toBe(0)
        if (failure) throw new Error('Transfer failed')
        return 'fresh photo'
    })
    const result = settled(body.driver.withStillMode(capture))
    if (failure) await expect(result).rejects.toThrow('Transfer failed')
    else await expect(result).resolves.toBe('fresh photo')
    expect(body.movie()).toBe(1)
})

it('reports the physical selector requirement without releasing or retrying movie mode', async () => {
    const body = canon({ movie: true, selector: 'ignored' })
    const capture = vi.fn()
    const outcome = settled(body.driver.withStillMode(capture))
    await expect(outcome).rejects.toBeInstanceOf(CameraUnsupportedError)
    await expect(outcome).rejects.toThrow('physical still/movie selector')
    expect(capture).not.toHaveBeenCalled()
    expect(body.enter).not.toHaveBeenCalled()
})
