import {
    canonImageFormatFromPacked,
    CanonImageFormatCodec,
} from '@vendors/canon/datasets/canon-image-format-dataset'
import {
    canonMovieFormatFromWire,
    CanonMovieFormatCodec,
} from '@vendors/canon/datasets/canon-movie-format-dataset'
import { CanonEventDataCodec } from '@vendors/canon/datasets/canon-event-data-dataset'
import { createCanonRegistry } from '@vendors/registry'
import { canonTestCamera, recordOperations } from '@tests/fixtures/canon-camera'
import { describe, expect, it, vi } from 'vitest'

function testCamera() {
    const { camera, cache, internals } = canonTestCamera()
    return { camera, cache, internals, operations: recordOperations(camera) }
}

describe('Canon card recording destination', () => {
    it.each([[[4, 2]], [[4, 6, 2]]])('uses the advertised card value of %j and restores host routing after the recording', async allowed => {
        const { camera, cache } = testCamera()
        const property = camera.registry.properties.CanonCaptureDestination
        cache.set(property, { current: 4, allowed })
        const writes: unknown[] = []
        camera.set = (async (target, value) => {
            expect(target).toBe(property)
            writes.push(value)
            cache.set(property, { current: value, allowed })
        }) as typeof camera.set
        const restore = await camera.prepareRecordingDestination()
        expect(writes).toEqual([2])
        await restore()
        await restore()
        expect(writes).toEqual([2, 4])
    })

    it('does not invent a card value or write redundantly when already on a card', async () => {
        const { camera, cache } = testCamera()
        const property = camera.registry.properties.CanonCaptureDestination
        camera.set = vi.fn()
        await (await camera.prepareRecordingDestination())()
        cache.set(property, { current: 2, allowed: [2, 4] })
        await (await camera.prepareRecordingDestination())()
        expect(camera.set).not.toHaveBeenCalled()
        for (const allowed of [undefined, [], [4], [0, 4]]) {
            cache.set(property, { current: 4, allowed })
            await expect(camera.prepareRecordingDestination()).rejects.toThrow('did not advertise a card')
        }
        expect(camera.set).not.toHaveBeenCalled()
    })

    it('restores the original destination when card preparation changes state then fails', async () => {
        const { camera, cache } = testCamera()
        const property = camera.registry.properties.CanonCaptureDestination
        cache.set(property, { current: 4, allowed: [2, 4] })
        camera.set = (async (_target, value) => {
            cache.set(property, { current: value, allowed: [2, 4] })
            if (value === 2) throw new Error('readback failed')
        }) as typeof camera.set
        await expect(camera.prepareRecordingDestination()).rejects.toThrow('readback failed')
        expect(cache.get(property)?.current).toBe(4)
    })
})

describe('Canon camera controls', () => {
    it('preserves the R6 III model identifier high bit from a four-byte property event', () => {
        const registry = createCanonRegistry(true)
        const payload = Uint8Array.of(16, 0, 0, 0, 0x89, 0xc1, 0, 0, 0x16, 0xd1, 0, 0, 0x18, 5, 0, 0x80)
        const event = new CanonEventDataCodec(registry).decode(payload).value[0]
        const property = registry.properties.CanonModelId
        const decoded = property.codec(registry).decode(event.valueData!)

        expect(event.parameters[0]).toBe(property.code)
        expect(property.datatype).toBe(0x0006)
        expect(decoded).toEqual({ value: 0x80000518, bytesRead: 4 })
    })

    it('enables Manual exposure with verified readback and avoids a redundant write', async () => {
        const {camera} = testCamera()
        let mode = 15, writes = 0
        camera.get = (async () => mode) as typeof camera.get
        camera.set = (async (property, value) => {expect(property.name).toBe('CanonAutoExposureMode');mode = Number(value);writes++}) as typeof camera.set
        await camera.setManualExposureMode()
        expect(mode).toBe(3)
        await camera.setManualExposureMode()
        expect(writes).toBe(1)
        camera.get = (async () => 15) as typeof camera.get
        await expect(camera.setManualExposureMode()).rejects.toThrow('did not confirm')
    })

    it('falls back to a released half-press when direct autofocus needs live view', async () => {
        const { camera, operations } = testCamera()
        camera.send = (async operation => {
            operations.push(operation.name)
            return { code: operation.name === 'CanonDoAutofocus' ? 0x2002 : 0x2001 }
        }) as typeof camera.send

        await camera.performAutofocus(0)

        expect(operations).toEqual(['CanonDoAutofocus', 'CanonRemoteReleaseOn', 'CanonRemoteReleaseOff'])
    })

    it('round-trips Canon single and dual still-image format structures', () => {
        const registry = createCanonRegistry(true)
        const codec = new CanonImageFormatCodec(registry)

        for (const packed of [0x03ff, 0x0c03, 0x0b02]) {
            const format = canonImageFormatFromPacked(packed)
            expect(codec.decode(codec.encode(format)).value).toEqual(format)
        }
        expect(canonImageFormatFromPacked(0x0c03).label).toBe('RAW+L')
    })

    it('round-trips and labels complete Canon movie-format records', () => {
        const registry = createCanonRegistry(true)
        const codec = new CanonMovieFormatCodec(registry)
        const mov = canonMovieFormatFromWire([36, 0, 0, 2500, 1, 0, 1, 0, 0])
        const mp4 = canonMovieFormatFromWire([36, 0, 1, 5000, 24, 0, 3, 1, 0])

        expect(codec.decode(codec.encode(mov)).value).toEqual(mov)
        expect(codec.decode(codec.encode(mp4)).value).toEqual(mp4)
        expect(mov.label).toBe('Full HD 25 fps · MOV · ALL-I')
        expect(mp4.label).toBe('HD 50 fps · MP4 · IPB (Standard)')
    })

    it('keeps each length-prefixed movie choice as one Canon property event value', () => {
        const registry = createCanonRegistry(true)
        const codec = new CanonEventDataCodec(registry)
        const choices = [
            [36, 0, 0, 2500, 1, 0, 1, 0, 0],
            [36, 0, 0, 2500, 12, 0, 3, 1, 0],
        ]
        const bytes = new Uint8Array(20 + choices.length * 36)
        const view = new DataView(bytes.buffer)
        view.setUint32(0, bytes.length, true)
        view.setUint16(4, 0xc18a, true)
        view.setUint32(8, 0xd1cd, true)
        view.setUint32(12, 3, true)
        view.setUint32(16, choices.length, true)
        choices.flat().forEach((value, index) => view.setUint32(20 + index * 4, value, true))

        const event = codec.decode(bytes).value[0]
        expect(event?.allowedValues).toBeUndefined()
        expect(event?.allowedValueData?.map(value => value.length)).toEqual([36, 36])
        expect(event?.allowedValueData?.map(value => new CanonMovieFormatCodec(registry).decode(value).value.label)).toEqual([
            'Full HD 25 fps · MOV · ALL-I',
            'Full HD 25 fps · MP4 · IPB (Standard)',
        ])
    })

    it('registers Canon network telemetry and rejects unadvertised mode changes by default', async () => {
        const { camera, cache } = testCamera()
        const communicationMode = camera.registry.properties.CanonNetworkCommunicationMode
        const region = camera.registry.properties.CanonNetworkServerRegion
        const wftStatus = camera.registry.properties.CanonWftStatus
                expect(camera.getNetworkState()).toEqual({
            communicationMode: undefined,
            communicationModeChoices: undefined,
            serverRegion: undefined,
            wftStatus: undefined,
        })
        cache.set(communicationMode, { current: 0, allowed: [0] })
        cache.set(region, { current: 0 })
        cache.set(wftStatus, { current: 0 })

        expect(camera.getNetworkState()).toEqual({
            communicationMode: 0,
            communicationModeChoices: [0],
            serverRegion: 0,
            wftStatus: 0,
        })
        await expect(camera.setNetworkCommunicationMode(1)).rejects.toThrow('was not advertised')
    })
})


describe('Canon interrupted recording Stop', () => {
    it('accepts freshly read idle state without sending another stop write', async () => {
        const { camera, cache } = testCamera()
        const property = camera.registry.properties.CanonRecordingDestination
        cache.set(property, { current: 'CARD' })
        let reads = 0, writes = 0
        camera.send = (async () => { reads++; cache.set(property, { current: 'NONE' }); return { code: 0x2001, data: [] } }) as typeof camera.send
        camera.set = (async () => { writes++ }) as typeof camera.set
        await camera.sendStopRecording()
        expect(reads).toBe(1)
        expect(writes).toBe(0)
    })

    it('retries busy Stop and accepts idle only after camera readback', async () => {
        const { camera, cache } = testCamera()
        const property = camera.registry.properties.CanonRecordingDestination
        cache.set(property, { current: 'CARD' })
        let writes = 0, reads = 0
        camera.send = (async () => { if (++reads === 2) cache.set(property, { current: 'NONE' }); return { code: 0x2001, data: [] } }) as typeof camera.send
        camera.set = (async () => { writes++; throw Object.assign(new Error('busy'), { code: 0x2019 }) }) as typeof camera.set
        await camera.sendStopRecording()
        expect(writes).toBe(1)
        expect(reads).toBe(2)
    })
})

it.each([
    { switching: 'enter', operation: 'CanonMovieSelectSwitchOn', codes: [0x2019, 0x2019, 0x2001], requests: 3 },
    { switching: 'enter', operation: 'CanonMovieSelectSwitchOn', codes: [0x2019], requests: 4 },
    { switching: 'enter', operation: 'CanonMovieSelectSwitchOn', codes: [0x2005], requests: 1 },
    { switching: 'leave', operation: 'CanonMovieSelectSwitchOff', codes: [0x2019, 0x2019, 0x2001], requests: 3 },
    { switching: 'leave', operation: 'CanonMovieSelectSwitchOff', codes: [0x2019], requests: 4 },
    { switching: 'leave', operation: 'CanonMovieSelectSwitchOff', codes: [0x2005], requests: 1 },
] as const)('bounds busy movie-mode $switching to $requests requests for codes $codes without repeating recording', async ({ switching, operation, codes, requests }) => {
    vi.useFakeTimers()
    try {
        const { camera } = testCamera()
        let attempts = 0
        camera.send = (async sent => {
            expect(sent.name).toBe(operation)
            return { code: codes[Math.min(attempts++, codes.length - 1)]! }
        }) as typeof camera.send
        const result = (switching === 'enter' ? camera.enterMovieMode() : camera.leaveMovieMode()).catch(error => error)
        await vi.runAllTimersAsync()
        const finalCode = codes.at(-1)!
        if (finalCode === 0x2001) expect(await result).toBeUndefined()
        else expect(await result).toMatchObject({ code: finalCode })
        expect(attempts).toBe(requests)
    } finally { vi.useRealTimers() }
})

it.each(['delayed', 'missing'] as const)('requires idle readback after an acknowledged Stop with %s telemetry', async telemetry => {
    vi.useFakeTimers()
    try {
        const { camera, cache } = testCamera()
        const property = camera.registry.properties.CanonRecordingDestination
        cache.set(property, { current: 'CARD' })
        let reads = 0, writes = 0
        camera.send = (async operation => {
            expect(operation.name).toBe('CanonGetEventData')
            if (++reads === 3 && telemetry === 'delayed')
                cache.set(property, { current: 'SDRAM' })
            return { code: 0x2001, data: [] }
        }) as typeof camera.send
        camera.set = (async (target, value) => {
            expect(target).toBe(property)
            expect(value).toBe('NONE')
            writes++
        }) as typeof camera.set
        const stop = camera.sendStopRecording().catch(error => error)
        await vi.runAllTimersAsync()
        const result = await stop
        if (telemetry === 'delayed') expect(result).toBeUndefined()
        else {
            expect(result).toBeInstanceOf(Error)
            expect(result.message).toContain('did not confirm recording stopped')
        }
        expect(writes).toBe(1)
        expect(reads).toBeGreaterThanOrEqual(3)
    } finally { vi.useRealTimers() }
})

it('an unrecognized Canon value cannot discard later exposure properties and choices', async () => {
    const { camera, internals } = testCamera()
    internals.processEvents([
        { code: 0xc189, parameters: [camera.registry.properties.CanonFocusMode.code, 999] },
        { code: 0xc189, parameters: [camera.registry.properties.CanonIso.code, 0x48] },
        { code: 0xc18a, parameters: [camera.registry.properties.CanonIso.code], allowedValues: [0x48, 0x50, 0x58] },
    ])
    const iso = (await camera.listPropertyStates()).find(property => property.name === 'CanonIso')
    expect(iso?.value).toBe('100')
    expect(iso?.allowedValues).toEqual(['100', '200', '400'])
    expect(camera.listUnknownPropertyStates().find(property => property.code === camera.registry.properties.CanonFocusMode.code)?.rawValue).toBe(999)
})
