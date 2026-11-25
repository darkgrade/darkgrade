/**
 * Camera.startRecording / stopRecording / getRecordingState on simulated Sony, Canon and Nikon
 * bodies. Property inventories, card listings and object information are encoded with the real
 * codecs; the drivers' own Record and Stop commands (tested at the wire in their driver tests)
 * flip the simulated recording state. Each vendor covers a confirmed take with its clip, a
 * refused start, and starts and stops whose outcome the camera never confirms.
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { CameraConfirmationError } from '@camera/confirmation'
import {
    CameraClipNotFoundError,
    CameraOutcomeUnknownError,
    CameraRefusedError,
    CameraUnsupportedError,
} from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { PTPDisconnectedError, PTPResponseError } from '@core/ptp-errors'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import { StorageInfoCodec } from '@ptp/datasets/storage-info-dataset'
import { canonAllowedValues, canonEvents, canonObjectAdded, canonValue } from '@tests/fixtures/canon-events'
import { encodeMediaId } from '@vendors/generic/media-id'
import type { PTPRegistry } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { protocolSession } from '@camera/protocol-session'
import { concatenate, encodedDeviceInfo, encodedObjectInfo, fakeTransport as transport, sonyPropertyInventory } from '@tests/fixtures/camera-fixtures'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

/** Advances fake time until the operation settles, so camera polling and settle waits run at once. */
async function settled<T>(operation: Promise<T>, limitMilliseconds = 120000): Promise<T> {
    let done = false
    operation.then(
        () => (done = true),
        () => (done = true)
    )
    for (let elapsed = 0; !done && elapsed < limitMilliseconds; elapsed += 50) await vi.advanceTimersByTimeAsync(50)
    return operation
}

async function failure(operation: Promise<unknown>): Promise<unknown> {
    return settled(operation.then(() => undefined, (error: unknown) => error))
}

const deviceInfo = (registry: PTPRegistry, model: string, properties: number[], operations: number[]) =>
    encodedDeviceInfo(registry, { model, devicePropertiesSupported: properties, operationsSupportedRaw: operations })

/** A card of movie files: GetStorageIDs, GetStorageInfo, GetObjectHandles and GetObjectInfo replies. */
function simulatedCard(registry: PTPRegistry, accessCapability = 0) {
    const files = new Map<number, { name: string; bytes: number }>([[1, { name: 'C0001.MP4', bytes: 1000 }]])
    const objectInfo = (handle: number) => {
        const file = files.get(handle)!
        return encodedObjectInfo(registry, { objectFormat: 0x300d, objectCompressedSize: file.bytes, filename: file.name })
    }
    const storageInfo = () => {
        const codec = new StorageInfoCodec(registry)
        return codec.decode(
            codec.encode({
                storageType: 4,
                filesystemType: 2,
                accessCapability,
                maxCapacity: 64_000_000_000n,
                freeSpaceInBytes: 32_000_000_000n,
                freeSpaceInImages: 1000,
                storageDescription: 'SD1',
                volumeLabel: '',
            })
        ).value
    }
    return {
        files,
        /** Writes the movie the camera finalizes when it stops. */
        finalize(name: string, bytes = 4096) {
            files.set(Math.max(...files.keys()) + 1, { name, bytes })
        },
        reply(operation: OperationDefinition, parameters: Record<string, number>) {
            if (operation.name === 'GetStorageIDs') return { code: 0x2001, data: [0x10001] }
            if (operation.name === 'GetStorageInfo') return { code: 0x2001, data: storageInfo() }
            if (operation.name === 'GetObjectHandles') return { code: 0x2001, data: [...files.keys()] }
            if (operation.name === 'GetObjectInfo') return { code: 0x2001, data: objectInfo(parameters.ObjectHandle!) }
            return undefined
        },
    }
}

// ---------------------------------------------------------------------------- Sony

/** SDIO property records; datatype 2 UINT8, 4 UINT16, 6 UINT32, as the a7 V reports them. */
interface SonyProperty {
    code: number
    type: 2 | 4 | 6
    value: number
    choices?: number[]
    enabled: number
    getSet: number
}

const sonyManual = 0x00000001
const sonyMovieManual = 0x00078053

function sonyCamera(options: { mode?: number; remainingSeconds?: number; firstContact?: boolean } = {}) {
    const camera = new Camera({ vendorId: 0x054c, transport: transport(), firstContact: options.firstContact })
    const driver = protocolSession(camera).driver as SonyCamera
    const registry = driver.registry
    const card = simulatedCard(registry)
    const body = {
        recording: 0,
        mode: options.mode ?? sonyManual,
        transfer: 0,
        remainingSeconds: options.remainingSeconds ?? 3600,
        startWorks: true,
        stopWorks: true,
    }
    const modeWrites: number[] = []
    const properties = (): SonyProperty[] => [
        { code: 0x500e, type: 6, value: body.mode, choices: [sonyManual, sonyMovieManual], enabled: 1, getSet: 1 },
        { code: 0xd21d, type: 2, value: body.recording, enabled: 2, getSet: 0 },
        { code: 0xd160, type: 4, value: 1, choices: [1, 2, 0x101], enabled: 1, getSet: 1 },
        { code: 0xd248, type: 2, value: 1, enabled: 2, getSet: 0 },
        // Still mode reads zero movie time even with a writable card, as on the a7 V.
        { code: 0xd24a, type: 6, value: body.mode === sonyMovieManual ? body.remainingSeconds : 0, enabled: 2, getSet: 0 },
        { code: 0xd295, type: 2, value: body.transfer, enabled: 1, getSet: 1 },
    ]
    const inventory = () =>
        sonyPropertyInventory(
            registry,
            properties().map(record => ({ ...record, datatype: record.type, current: record.value, writable: record.getSet === 1 }))
        )
    const send = async (operation: OperationDefinition, parameters: Record<string, number | string>, data?: Uint8Array) => {
        const cardReply = card.reply(operation, parameters as Record<string, number>)
        if (cardReply) return cardReply
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(registry, 'ILCE-7M5', [], [0x1001]) }
        if (operation.name === 'SDIO_GetAllExtDevicePropInfo') return { code: 0x2001, data: inventory() }
        if (operation.name === 'SDIO_SetContentsTransferMode') {
            body.transfer = parameters.TransferMode === 'ENABLE' ? 1 : 0
            return { code: 0x2001 }
        }
        if (operation.name === 'SDIO_SetExtDevicePropValue' && parameters.DevicePropCode === 0x500e) {
            body.mode = registry.codecs.uint32.decode(data!).value
            modeWrites.push(body.mode)
            return { code: 0x2001 }
        }
        throw new Error(`Unexpected Sony operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const start = vi.spyOn(driver, 'sendStartRecording').mockImplementation(async () => {
        if (body.startWorks) body.recording = 1
    })
    const stop = vi.spyOn(driver, 'sendStopRecording').mockImplementation(async () => {
        if (!body.stopWorks || body.recording !== 1) return
        body.recording = 0
        card.finalize('C0002.MP4')
    })
    return { camera, driver, body, card, modeWrites, start, stop }
}

/**
 * Replaces the driver's session lifecycle on the same Camera: disconnect closes the session, and
 * connect or recover opens the next one (a new id, as a fresh OpenSession has), unless `keep` says
 * the body preserved its interrupted session (Nikon during a recording).
 */
function sessionLifecycle(driver: SonyCamera | CanonCamera | NikonCamera, options: { keep?: boolean } = {}) {
    let next = 100
    driver.sessionId = next
    let previous: number | null = driver.sessionId
    vi.spyOn(driver, 'disconnect').mockImplementation(async () => {
        previous = driver.sessionId
        driver.sessionId = null
    })
    vi.spyOn(driver, 'connect').mockImplementation(async () => {
        driver.sessionId = options.keep ? previous : ++next
    })
    vi.spyOn(driver, 'recover').mockImplementation(async () => {
        driver.sessionId = options.keep ? driver.sessionId : ++next
        return { recovered: true, needsPhysicalAction: false, steps: [], durationMilliseconds: 0 }
    })
}

describe('Sony recording through the generic Camera', () => {
    it('selects the movie mode, records once, returns the new clip and restores the photo mode', async () => {
        const sony = sonyCamera()
        expect(await sony.camera.getRecordingState()).toBe('idle')
        await settled(sony.camera.startRecording())
        expect(sony.modeWrites).toEqual([sonyMovieManual])
        expect(await sony.camera.getRecordingState()).toBe('recording')
        const clip = await settled(sony.camera.stopRecording())
        expect(clip).toEqual({ mediaId: '2', name: 'C0002.MP4', sizeBytes: 4096 })
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
        expect(sony.start).toHaveBeenCalledOnce()
        expect(sony.stop).toHaveBeenCalledOnce()
    })

    it('refuses to start when the movie card has no time left, and puts the mode back', async () => {
        const sony = sonyCamera({ remainingSeconds: 0 })
        const error = await failure(sony.camera.startRecording())
        expect(error).toBeInstanceOf(CameraRefusedError)
        expect(String(error)).toContain('No movie recording time')
        expect(sony.start).not.toHaveBeenCalled()
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
    })

    it('reports an ignored Record as unconfirmed, releases the press once and puts the mode back', async () => {
        const sony = sonyCamera()
        sony.body.startWorks = false
        const error = await failure(sony.camera.startRecording())
        expect(error).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(error).toMatchObject({ expected: 'recording', observed: 'idle' })
        expect(sony.start).toHaveBeenCalledOnce()
        expect(sony.stop).toHaveBeenCalledOnce()
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
        // Nothing is recording now, so a Stop finds no clip and sends nothing more.
        expect(await failure(sony.camera.stopRecording())).toBeInstanceOf(CameraClipNotFoundError)
        expect(sony.stop).toHaveBeenCalledOnce()
    })

    it('treats native state 2 (recording failed) as unknown: the mode is kept and Stop stays available', async () => {
        const sony = sonyCamera()
        sony.start.mockImplementation(async () => {
            sony.body.recording = 2
        })
        expect(await failure(sony.camera.startRecording())).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(await sony.camera.getRecordingState()).toBe('unknown')
        expect(sony.modeWrites).toEqual([sonyMovieManual])
        expect(await failure(sony.camera.startRecording())).toBeInstanceOf(CameraRefusedError)
        sony.body.recording = 1
        await settled(sony.camera.stopRecording())
        expect(sony.start).toHaveBeenCalledOnce()
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
    })

    it('keeps the movie mode after an unconfirmed Stop and confirms a later explicit Stop', async () => {
        const sony = sonyCamera()
        await settled(sony.camera.startRecording())
        sony.body.stopWorks = false
        const error = await failure(sony.camera.stopRecording())
        expect(error).toBeInstanceOf(CameraConfirmationError)
        expect(error).toMatchObject({ expected: 'idle', observed: 'recording' })
        expect(sony.stop).toHaveBeenCalledOnce()
        expect(sony.modeWrites).toEqual([sonyMovieManual])
        sony.body.stopWorks = true
        expect((await settled(sony.camera.stopRecording())).name).toBe('C0002.MP4')
        expect(sony.stop).toHaveBeenCalledTimes(2)
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
    })

    it('says so when the camera stopped but no new clip reached the card, after restoring the mode', async () => {
        const sony = sonyCamera()
        await settled(sony.camera.startRecording())
        sony.stop.mockImplementation(async () => {
            sony.body.recording = 0
        })
        const error = await failure(sony.camera.stopRecording())
        expect(error).toBeInstanceOf(CameraClipNotFoundError)
        expect(error).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
        expect(await sony.camera.getRecordingState()).toBe('idle')
    })

    it('reads native states 2 and 3 (failed, interval waiting) and unknown codes as unknown, never idle', async () => {
        const sony = sonyCamera()
        for (const [native, expected] of [
            [0, 'idle'],
            [1, 'recording'],
            [2, 'unknown'],
            [3, 'unknown'],
            [4, 'unknown'],
        ] as const) {
            sony.body.recording = native
            expect(await sony.camera.getRecordingState()).toBe(expected)
        }
    })

    it('maps a failed idle check before Record to the public errors, without sending anything', async () => {
        const sony = sonyCamera()
        vi.spyOn(sony.driver, 'send').mockRejectedValueOnce(new PTPDisconnectedError('USB transfer failed'))
        expect(await failure(sony.camera.startRecording())).toBeInstanceOf(CameraOutcomeUnknownError)
        vi.spyOn(sony.driver, 'send').mockRejectedValueOnce(new PTPResponseError(0x2019, 'Device busy'))
        const refused = await failure(sony.camera.startRecording())
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(refused).not.toBeInstanceOf(CameraOutcomeUnknownError)
        expect(sony.start).not.toHaveBeenCalled()
        expect(sony.modeWrites).toEqual([])
    })

    it('refuses to start while the camera reports recording, without sending Record', async () => {
        const sony = sonyCamera()
        sony.body.recording = 1
        expect(await failure(sony.camera.startRecording())).toBeInstanceOf(CameraRefusedError)
        expect(sony.start).not.toHaveBeenCalled()
        expect(sony.modeWrites).toEqual([])
        // A recording this connection did not start can still be stopped; its clip is not claimed.
        expect(await failure(sony.camera.stopRecording())).toBeInstanceOf(CameraClipNotFoundError)
        expect(sony.stop).toHaveBeenCalledOnce()
        expect(await sony.camera.getRecordingState()).toBe('idle')
    })

    it('does not identify a clip after the PTP session was renewed between Record and Stop', async () => {
        const sony = sonyCamera()
        const driver = protocolSession(sony.camera).driver
        driver.sessionId = 7
        await settled(sony.camera.startRecording())
        driver.sessionId = 8
        expect(await failure(sony.camera.stopRecording())).toBeInstanceOf(CameraClipNotFoundError)
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
    })

    it('after disconnect/connect on the same Camera: refuses a new start, stops once, restores and claims no clip', async () => {
        const sony = sonyCamera({ firstContact: false })
        sessionLifecycle(sony.driver)
        await settled(sony.camera.startRecording())
        await sony.camera.disconnect()
        await sony.camera.connect()
        const refused = await failure(sony.camera.startRecording())
        expect(refused).toBeInstanceOf(CameraRefusedError)
        expect(String(refused)).toContain('reconnected')
        expect(sony.start).toHaveBeenCalledOnce()
        const error = await failure(sony.camera.stopRecording())
        expect(error).toBeInstanceOf(CameraClipNotFoundError)
        expect(String(error)).toContain('renewed')
        expect(sony.stop).toHaveBeenCalledOnce()
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
        // The finished session is gone: the same Camera records again and finds its own clip.
        await settled(sony.camera.startRecording())
        // Handle 2 appeared while the first take was not identifiable; the new take is handle 3.
        expect((await settled(sony.camera.stopRecording())).mediaId).toBe('3')
        expect(sony.start).toHaveBeenCalledTimes(2)
    })

    it('after a take ended during a reconnect: sends no Stop, restores the mode and claims no clip', async () => {
        const sony = sonyCamera({ firstContact: false })
        sessionLifecycle(sony.driver)
        await settled(sony.camera.startRecording())
        await sony.camera.disconnect()
        sony.body.recording = 0
        sony.card.finalize('C0002.MP4')
        await sony.camera.connect()
        expect(await failure(sony.camera.stopRecording())).toBeInstanceOf(CameraClipNotFoundError)
        expect(sony.stop).not.toHaveBeenCalled()
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual])
    })

    it('serializes rapid start, stop, start, stop: each command once, in order, each clip its own', async () => {
        const sony = sonyCamera()
        const order: string[] = []
        sony.start.mockImplementation(async () => {
            order.push('start')
            sony.body.recording = 1
        })
        sony.stop.mockImplementation(async () => {
            order.push('stop')
            sony.body.recording = 0
            sony.card.finalize(`C000${sony.card.files.size + 1}.MP4`)
        })
        const results = settled(
            Promise.all([
                sony.camera.startRecording(),
                sony.camera.stopRecording(),
                sony.camera.startRecording(),
                sony.camera.stopRecording(),
            ])
        )
        const [, first, , second] = await results
        expect(order).toEqual(['start', 'stop', 'start', 'stop'])
        expect([first.name, second.name]).toEqual(['C0002.MP4', 'C0003.MP4'])
        expect(sony.modeWrites).toEqual([sonyMovieManual, sonyManual, sonyMovieManual, sonyManual])
    })
})

// ---------------------------------------------------------------------------- Canon

const canonEvent = {
    destination: 0xd1b8,
    captureDestination: 0xd11c,
    exposureMode: 0xd105,
    sound: 0xd195,
    fixedMovie: 0xd1c2,
}

function canonCamera(options: { movie?: boolean; sound?: number; access?: number } = {}) {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const registry = driver.registry
    const card = simulatedCard(registry, options.access ?? 0)
    const values = new Map<number, number>([
        [canonEvent.destination, 0],
        [canonEvent.captureDestination, 2],
        [canonEvent.exposureMode, 1],
        [canonEvent.sound, options.sound ?? 2],
        [canonEvent.fixedMovie, options.movie ? 1 : 0],
    ])
    const allowed = new Map<number, number[]>([
        [canonEvent.captureDestination, [2, 4]],
        [canonEvent.sound, [1, 2, 3]],
        [canonEvent.exposureMode, [1, 3]],
    ])
    const commands: string[] = []
    const writes: [number, number][] = []
    // Each GetEvent reports every value and choice list, then the files announced since the last one.
    const announced: Uint8Array[] = []
    const events = () =>
        canonEvents(registry, [
            ...[...values].map(([code, value]) => canonValue(code, value)),
            ...[...allowed].map(([code, choices]) => canonAllowedValues(code, choices)),
            ...announced.splice(0),
        ])
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        const cardReply = card.reply(operation, parameters)
        if (cardReply) return cardReply
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(registry, 'Canon EOS R8', [], [0x1001]) }
        if (operation.name === 'CanonGetEventData') return { code: 0x2001, data: events() }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            const code = view.getUint32(4, true)
            const value = view.getUint32(8, true)
            writes.push([code, value])
            values.set(code, value)
            return { code: 0x2001 }
        }
        if (operation.name === 'CanonMovieSelectSwitchOn' || operation.name === 'CanonMovieSelectSwitchOff') {
            commands.push(operation.name)
            values.set(canonEvent.fixedMovie, operation.name === 'CanonMovieSelectSwitchOn' ? 1 : 0)
            return { code: 0x2001 }
        }
        throw new Error(`Unexpected Canon operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const body = { startWorks: true, stopWorks: true }
    const start = vi.spyOn(driver, 'sendStartRecording').mockImplementation(async () => {
        if (body.startWorks) values.set(canonEvent.destination, 4)
    })
    const stop = vi.spyOn(driver, 'sendStopRecording').mockImplementation(async () => {
        if (!body.stopWorks) return
        values.set(canonEvent.destination, 0)
        card.finalize('MVI_0002.MP4', 8192)
        const handle = Math.max(...card.files.keys())
        announced.push(canonObjectAdded(handle, 'MVI_0002.MP4', 8192, 0x10001))
    })
    return { camera, driver, body, values, writes, commands, start, stop }
}

/** The id listMedia gives the clip: the same card object, name and size. */
const canonClipId = (objectHandle: number) =>
    encodeMediaId({ source: 'object', storageId: 0x10001, objectHandle, name: 'MVI_0002.MP4', sizeBytes: 8192 })

describe('Canon recording through the generic Camera', () => {
    it('selects movie mode, records once, returns the clip and selects photo mode again', async () => {
        const canon = canonCamera()
        expect(await canon.camera.getRecordingState()).toBe('idle')
        await settled(canon.camera.startRecording())
        expect(canon.commands).toEqual(['CanonMovieSelectSwitchOn'])
        expect(await canon.camera.getRecordingState()).toBe('recording')
        expect(await settled(canon.camera.stopRecording())).toEqual({ mediaId: canonClipId(2), name: 'MVI_0002.MP4', sizeBytes: 8192 })
        expect(canon.commands).toEqual(['CanonMovieSelectSwitchOn', 'CanonMovieSelectSwitchOff'])
        expect(canon.start).toHaveBeenCalledOnce()
        expect(canon.stop).toHaveBeenCalledOnce()
    })

    it('records with sound off after setAudioRecording("Off"): Record and Stop write no sound change', async () => {
        const canon = canonCamera({ sound: 2 })
        expect(await settled(canon.camera.setAudioRecording('Off'))).toBe('Off')
        expect(canon.writes).toEqual([[canonEvent.sound, 1]])
        await settled(canon.camera.startRecording())
        await settled(canon.camera.stopRecording())
        expect(canon.writes.filter(([code]) => code === canonEvent.sound)).toEqual([[canonEvent.sound, 1]])
        expect(canon.values.get(canonEvent.sound)).toBe(1)
        expect(await settled(canon.camera.getAudioRecording())).toBe('Off')
        expect(canon.commands).toEqual(['CanonMovieSelectSwitchOn', 'CanonMovieSelectSwitchOff'])
    })

    it('leaves an operator-chosen Off and a manual sound level exactly as they were', async () => {
        for (const sound of [1, 3]) {
            const canon = canonCamera({ movie: true, sound })
            await settled(canon.camera.startRecording())
            await settled(canon.camera.stopRecording())
            expect(canon.writes).toEqual([])
            expect(canon.values.get(canonEvent.sound)).toBe(sound)
        }
    })

    it('refuses without a writable card and sends no mode change or Record', async () => {
        const canon = canonCamera({ access: 1 })
        const error = await failure(canon.camera.startRecording())
        expect(error).toBeInstanceOf(CameraRefusedError)
        expect(String(error)).toContain('writable memory card')
        expect(canon.commands).toEqual([])
        expect(canon.start).not.toHaveBeenCalled()
    })

    it('keeps movie mode after an unconfirmed Stop and sends no mode change', async () => {
        const canon = canonCamera()
        await settled(canon.camera.startRecording())
        canon.body.stopWorks = false
        const error = await failure(canon.camera.stopRecording())
        expect(error).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(canon.commands).toEqual(['CanonMovieSelectSwitchOn'])
        expect(await canon.camera.getRecordingState()).toBe('recording')
    })

    it('after recover on the same Camera: Stop is sent once, movie mode is put back, and a new file is not claimed', async () => {
        const canon = canonCamera()
        sessionLifecycle(canon.driver)
        await settled(canon.camera.startRecording())
        await canon.camera.recover()
        expect(await failure(canon.camera.stopRecording())).toBeInstanceOf(CameraClipNotFoundError)
        expect(canon.stop).toHaveBeenCalledOnce()
        expect(canon.commands).toEqual(['CanonMovieSelectSwitchOn', 'CanonMovieSelectSwitchOff'])
        await settled(canon.camera.startRecording())
        expect((await settled(canon.camera.stopRecording())).mediaId).toBe(canonClipId(3))
    })

    it('reports a refused Record as refused and leaves the camera as it was', async () => {
        const canon = canonCamera()
        canon.start.mockRejectedValue(new Error('Canon recording destination write returned 0x2019'))
        const error = await failure(canon.camera.startRecording())
        expect(error).toBeInstanceOf(CameraRefusedError)
        expect(canon.commands).toEqual(['CanonMovieSelectSwitchOn', 'CanonMovieSelectSwitchOff'])
    })
})

// ---------------------------------------------------------------------------- Nikon

function nikonCamera(options: { firstContact?: boolean } = {}) {
    const camera = new Camera({ vendorId: 0x04b0, transport: transport(), firstContact: options.firstContact })
    const driver = protocolSession(camera).driver as NikonCamera
    driver.sessionId = 1
    const registry = driver.registry
    const card = simulatedCard(registry)
    const status = registry.properties.MovieRecProhibitionCondition.code
    const body = { flags: 0, readable: true, stopWorks: true, finalBytes: 0xffffffff, largeSize: 5_000_000_000 }
    /** Nikon announces each new card object with ObjectAdded, queued until GetEventEx reads it. */
    const queued: { code: number; parameters: number[] }[] = []
    const finalize = (name: string, bytes: number) => {
        card.finalize(name, bytes)
        queued.push({ code: registry.events.ObjectAdded.code, parameters: [Math.max(...card.files.keys())] })
    }
    const descriptor = (value: number) => {
        const wire = concatenate([
            registry.codecs.uint32.encode(status),
            registry.codecs.uint16.encode(6),
            Uint8Array.of(0),
            registry.codecs.uint32.encode(0),
            registry.codecs.uint32.encode(value),
            Uint8Array.of(0),
        ])
        return new DevicePropDescCodec(registry, true).decode(wire).value
    }
    const send = async (operation: OperationDefinition, parameters: Record<string, number>) => {
        const cardReply = card.reply(operation, parameters)
        if (cardReply) return cardReply
        if (operation.name === 'GetDevicePropDescEx' && parameters.DevicePropCode === status)
            return body.readable ? { code: 0x2001, data: descriptor(body.flags) } : { code: 0x2005 }
        if (operation.name === 'GetObjectSize') return { code: 0x2001, data: BigInt(body.largeSize) }
        if (operation.name === 'GetEventEx') return { code: 0x2001, data: queued.splice(0) }
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(registry, 'Z 6III', [], []) }
        throw new Error(`Unexpected Nikon operation ${operation.name}`)
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    const start = vi.spyOn(driver, 'sendStartRecording').mockImplementation(async () => {
        body.flags = 0x400
    })
    const stop = vi.spyOn(driver, 'sendStopRecording').mockImplementation(async () => {
        if (!body.stopWorks) return
        body.flags = 0
        finalize('DSC_0002.MOV', body.finalBytes)
    })
    return { camera, driver, body, card, finalize, start, stop }
}

describe('Nikon recording through the generic Camera', () => {
    it('confirms Record from the fresh movie-status descriptor and sizes a clip over 4 GiB', async () => {
        const nikon = nikonCamera()
        await settled(nikon.camera.startRecording())
        expect(await nikon.camera.getRecordingState()).toBe('recording')
        const clip = await settled(nikon.camera.stopRecording())
        expect(clip).toEqual({ mediaId: 'ptp:10001:2::DSC_0002.MOV', name: 'DSC_0002.MOV', sizeBytes: 5_000_000_000 })
        const sent = vi.mocked(nikon.driver.send).mock.calls.map(([operation]) => operation.name)
        expect(sent).not.toContain('GetObjectHandles')
        const listed = await nikon.camera.listMedia()
        expect(listed.find(item => item.name === 'DSC_0002.MOV')?.id).toBe(clip.mediaId)
    })

    it('maps a prohibited Record that left the body idle to a refusal', async () => {
        const nikon = nikonCamera()
        nikon.start.mockRejectedValue(new Error('Movie recording is prohibited: noCardInserted'))
        const error = await failure(nikon.camera.startRecording())
        expect(error).toBeInstanceOf(CameraRefusedError)
        expect(String(error)).toContain('noCardInserted')
    })

    it('never treats an unreadable status as idle: Record is refused and Stop reports the unknown outcome', async () => {
        const nikon = nikonCamera()
        nikon.body.readable = false
        expect(await nikon.camera.getRecordingState()).toBe('unknown')
        expect(await failure(nikon.camera.startRecording())).toBeInstanceOf(CameraRefusedError)
        expect(nikon.start).not.toHaveBeenCalled()
        expect(await failure(nikon.camera.stopRecording())).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(nikon.stop).toHaveBeenCalledOnce()
    })

    it('waits for buffered frames (stopping) to reach idle, then reports the finished clip', async () => {
        const nikon = nikonCamera()
        await settled(nikon.camera.startRecording())
        nikon.stop.mockImplementation(async () => {
            nikon.body.flags = 0x200
            setTimeout(() => {
                nikon.body.flags = 0
                nikon.finalize('DSC_0002.MOV', 2048)
            }, 1000)
        })
        const stopping = nikon.camera.stopRecording()
        await vi.advanceTimersByTimeAsync(500)
        expect(await nikon.camera.getRecordingState()).toBe('stopping')
        expect(await settled(stopping)).toEqual({ mediaId: 'ptp:10001:2:2048:DSC_0002.MOV', name: 'DSC_0002.MOV', sizeBytes: 2048 })
        expect(nikon.stop).toHaveBeenCalledOnce()
    })

    it('keeps the take across a reconnect that preserved the interrupted session, and finds its clip', async () => {
        const nikon = nikonCamera({ firstContact: false })
        sessionLifecycle(nikon.driver, { keep: true })
        await settled(nikon.camera.startRecording())
        await nikon.camera.disconnect()
        await nikon.camera.connect()
        expect(await nikon.camera.getRecordingState()).toBe('recording')
        expect((await settled(nikon.camera.stopRecording())).name).toBe('DSC_0002.MOV')
        expect(nikon.stop).toHaveBeenCalledOnce()
    })
})

describe('cameras that cannot record', () => {
    it('report CameraUnsupportedError for every recording operation', async () => {
        const camera = new Camera({ vendorId: 0x1234, transport: transport() })
        for (const operation of [
            () => camera.startRecording(),
            () => camera.stopRecording(),
            () => camera.getRecordingState(),
        ])
            await expect(operation()).rejects.toBeInstanceOf(CameraUnsupportedError)
    })
})
