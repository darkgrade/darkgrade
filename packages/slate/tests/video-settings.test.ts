/**
 * The typed video settings (videoFormat, videoQuality, frameRate, audioRecording) on simulated
 * Sony, Canon and Nikon bodies whose replies are encoded with the real codecs: a confirmed write,
 * a refused value, an unavailable setting and a write the camera never shows.
 */
import type { CanonCamera } from '@vendors/canon/canon-camera'
import { resolveCameraControl } from '@camera/controls'
import { CameraOutcomeUnknownError, CameraRefusedError, CameraUnsupportedError } from '@camera/errors'
import { Camera } from '@camera/index'
import type { NikonCamera } from '@vendors/nikon/nikon-camera'
import type { SonyCamera } from '@vendors/sony/sony-camera'
import { DevicePropDescCodec } from '@ptp/datasets/device-prop-desc-dataset'
import type { PTPRegistry } from '@ptp/types/codec'
import type { OperationDefinition } from '@ptp/types/operation'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { AudioRecording, FrameRate, VideoFormat, VideoQuality } from '@camera/settings/video'
import { protocolSession } from '@camera/protocol-session'
import { canonAllowedValues, canonEvents, canonValue } from '@tests/fixtures/canon-events'
import { concatenate, encodedDeviceInfo, fakeTransport as transport, sonyPropertyInventory } from '@tests/fixtures/camera-fixtures'

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

const deviceInfo = (registry: PTPRegistry, properties: number[]) =>
    encodedDeviceInfo(registry, { devicePropertiesSupported: properties })

interface SonyRecord {
    type: 2 | 4
    value: number
    choices: number[]
    enabled: number
}

/** The a7 V's movie properties as it reported them on 2026-11-24 (codes, datatypes and raw choices). */
function sonyCamera() {
    const camera = new Camera({ vendorId: 0x054c, transport: transport() })
    const driver = protocolSession(camera).driver as SonyCamera
    const registry = driver.registry
    const records = new Map<number, SonyRecord>([
        [0xd241, { type: 2, value: 14, choices: [11, 8, 9, 14, 15], enabled: 1 }], // MovieFileFormat, XAVC S-I 4K
        [0xd242, { type: 4, value: 41, choices: [41], enabled: 1 }], // MovieRecordingSetting, 300M 4:2:2 10-bit
        [0xd286, { type: 2, value: 5, choices: [3, 5, 7], enabled: 1 }], // MovieRecordingFrameRate, 30p
        // AudioRecording, raw 1; its value meanings are undocumented, so Slate does not map it.
        [0xd0d2, { type: 2, value: 1, choices: [1, 0], enabled: 1 }],
    ])
    const body = { applies: true }
    const writes: [number, number][] = []
    const send = async (operation: OperationDefinition, parameters: Record<string, number>, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(registry, []) }
        if (operation.name === 'SDIO_SetExtDevicePropValue') {
            const record = records.get(parameters.DevicePropCode!)!
            const value = record.type === 2 ? registry.codecs.uint8.decode(data!).value : registry.codecs.uint16.decode(data!).value
            writes.push([parameters.DevicePropCode!, value])
            if (body.applies) record.value = value
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('SDIO_GetAllExtDevicePropInfo')
        const inventory = [...records].map(([code, record]) => ({ code, datatype: record.type, ...record, current: record.value }))
        return { code: 0x2001, data: sonyPropertyInventory(registry, inventory) }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, records, body, writes }
}

describe('Sony typed video settings', () => {
    it('reads canonical values and confirms each write by its readback', async () => {
        const { camera, writes } = sonyCamera()
        expect(await camera.getVideoFormat()).toBe('XAVC S-I 4K')
        expect(await camera.getVideoQuality()).toBe('300M 4:2:2 10-bit')
        expect(await camera.getFrameRate()).toBe('30p')
        expect(await camera.setVideoFormat('XAVC HS 4K')).toBe('XAVC HS 4K')
        expect(await camera.setFrameRate('24p')).toBe('24p')
        expect(writes).toEqual([
            [0xd241, 11],
            [0xd286, 7],
        ])
        const capabilities = await camera.getCapabilities()
        expect(capabilities.controls.frameRate?.allowedValues).toEqual(['60p', '30p', '24p'])
    })

    it('does not offer audio recording: the a7 V recorded sound with AudioRecording at raw 0', async () => {
        const { camera, writes } = sonyCamera()
        expect((await camera.getCapabilities()).controls.audioRecording).toBeUndefined()
        await expect(camera.getAudioRecording()).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.setAudioRecording('Off')).rejects.toBeInstanceOf(CameraUnsupportedError)
        expect(writes).toEqual([])
    })

    it('refuses a value the camera does not offer now, before anything is sent', async () => {
        const { camera, writes } = sonyCamera()
        await expect(camera.setFrameRate('120p')).rejects.toBeInstanceOf(CameraRefusedError)
        await expect(camera.setVideoQuality('150M 4:2:0 10-bit')).rejects.toBeInstanceOf(CameraRefusedError)
        expect(writes).toEqual([])
    })

    it('reports a greyed-out setting as unsupported', async () => {
        const { camera, records } = sonyCamera()
        records.get(0xd286)!.enabled = 0
        await expect(camera.setFrameRate('24p')).rejects.toBeInstanceOf(CameraUnsupportedError)
    })

    it('reports a write the camera acknowledged but never showed as an unknown outcome, sent once', async () => {
        vi.useFakeTimers()
        const { camera, body, writes } = sonyCamera()
        body.applies = false
        const result = camera.setFrameRate('60p').catch(error => error)
        await vi.advanceTimersByTimeAsync(10000)
        expect(await result).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(writes).toEqual([[0xd286, 3]])
    })

    it('does not name a raw value no codec knows', async () => {
        const { camera, records } = sonyCamera()
        records.get(0xd286)!.value = 0xfe
        await expect(camera.getFrameRate()).rejects.toBeInstanceOf(CameraUnsupportedError)
    })
})

/** Canon movie sound as CanonGetEventData records; writes through CanonSetPropValue. */
function canonCamera() {
    const camera = new Camera({ vendorId: 0x04a9, transport: transport(), keepAlive: false })
    const driver = protocolSession(camera).driver as CanonCamera
    const sound = driver.registry.properties.CanonMovieSoundRecording.code
    const body = { value: 2, choices: [1, 2, 3], applies: true }
    const writes: number[] = []
    const send = async (operation: OperationDefinition, _parameters: unknown, data?: Uint8Array) => {
        if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(driver.registry, []) }
        if (operation.name === 'CanonSetPropValue') {
            const view = new DataView(data!.buffer, data!.byteOffset, data!.byteLength)
            expect(view.getUint32(4, true)).toBe(sound)
            writes.push(view.getUint32(8, true))
            if (body.applies) body.value = view.getUint32(8, true)
            return { code: 0x2001 }
        }
        expect(operation.name).toBe('CanonGetEventData')
        const records = [canonValue(sound, body.value), canonAllowedValues(sound, body.choices)]
        return { code: 0x2001, data: canonEvents(driver.registry, records) }
    }
    vi.spyOn(driver, 'send').mockImplementation(send as never)
    return { camera, body, writes }
}

describe('Canon typed audio recording', () => {
    it('names movie sound On, Off and On (manual level), and confirms a write', async () => {
        const { camera, writes } = canonCamera()
        expect(await camera.getAudioRecording()).toBe('On')
        expect((await camera.getCapabilities()).controls.audioRecording?.allowedValues).toEqual([
            'Off',
            'On',
            'On (manual level)',
        ])
        expect(await camera.setAudioRecording('Off')).toBe('Off')
        expect(writes).toEqual([1])
    })

    it('refuses a choice the body does not advertise and reports an unobserved write as unknown', async () => {
        vi.useFakeTimers()
        const { camera, body, writes } = canonCamera()
        body.choices = [1, 2]
        await expect(camera.setAudioRecording('On (manual level)')).rejects.toBeInstanceOf(CameraRefusedError)
        body.applies = false
        const result = camera.setAudioRecording('Off').catch(error => error)
        await vi.advanceTimersByTimeAsync(5000)
        expect(await result).toBeInstanceOf(CameraOutcomeUnknownError)
        expect(writes).toEqual([1])
    })

    it('has no frame rate or quality of its own: they are part of the video format record', async () => {
        const { camera } = canonCamera()
        await expect(camera.getFrameRate()).rejects.toBeInstanceOf(CameraUnsupportedError)
        await expect(camera.getVideoQuality()).rejects.toBeInstanceOf(CameraUnsupportedError)
    })
})

describe('Nikon typed video settings', () => {
    it('are unsupported until Nikon movie format properties are decoded', async () => {
        const camera = new Camera({ vendorId: 0x04b0, transport: transport() })
        const driver = protocolSession(camera).driver as NikonCamera
        driver.sessionId = 1
        const selector = driver.registry.properties.LiveViewSelector.code
        vi.spyOn(driver, 'send').mockImplementation((async (operation: OperationDefinition, parameters: Record<string, number>) => {
            if (operation.name === 'GetDeviceInfo') return { code: 0x2001, data: deviceInfo(driver.registry, [selector]) }
            if (operation.name.startsWith('GetDevicePropDesc') && parameters.DevicePropCode === selector) {
                const codecs = driver.registry.codecs
                const wire = concatenate([
                    codecs.uint32.encode(selector),
                    codecs.uint16.encode(2),
                    Uint8Array.of(1),
                    codecs.uint8.encode(1),
                    codecs.uint8.encode(1),
                    Uint8Array.of(0),
                ])
                return { code: 0x2001, data: new DevicePropDescCodec(driver.registry, true).decode(wire).value }
            }
            return { code: 0x200a }
        }) as never)
        for (const read of [() => camera.getVideoFormat(), () => camera.getFrameRate(), () => camera.getAudioRecording()])
            await expect(read()).rejects.toBeInstanceOf(CameraUnsupportedError)
    })
})

describe('video setting vocabulary', () => {
    it('finds each setting by the words people and vendors use', () => {
        expect(resolveCameraControl('codec')).toBe('videoFormat')
        expect(resolveCameraControl('movie format')).toBe('videoFormat')
        expect(resolveCameraControl('movieSetting')).toBe('videoQuality')
        expect(resolveCameraControl('bit rate')).toBe('videoQuality')
        expect(resolveCameraControl('fps')).toBe('frameRate')
        expect(resolveCameraControl('movieFrameRate')).toBe('frameRate')
        expect(resolveCameraControl('sound')).toBe('audioRecording')
    })

    it('types each setter with the codec names', () => {
        const camera = new Camera({ vendorId: 0x054c, transport: transport() })
        expectTypeOf(camera.setFrameRate).parameter(0).toEqualTypeOf<FrameRate>()
        expectTypeOf(camera.getVideoFormat).returns.resolves.toEqualTypeOf<VideoFormat>()
        expectTypeOf(camera.getVideoQuality).returns.resolves.toEqualTypeOf<VideoQuality>()
        expectTypeOf(camera.setAudioRecording).parameter(0).toEqualTypeOf<AudioRecording>()
        expectTypeOf<'24p'>().toMatchTypeOf<FrameRate>()
        expectTypeOf<'Full HD 25 fps · MP4 · IPB (Standard)'>().toMatchTypeOf<VideoFormat>()
        expectTypeOf<'camera-specific-0'>().not.toMatchTypeOf<AudioRecording>()
    })
})
