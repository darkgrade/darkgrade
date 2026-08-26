import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import {
    canonImageFormatFromPacked,
    CanonImageFormatCodec,
} from '@ptp/datasets/vendors/canon/canon-image-format-dataset'
import {
    canonMovieFormatFromWire,
    CanonMovieFormatCodec,
} from '@ptp/datasets/vendors/canon/canon-movie-format-dataset'
import { CanonEventDataCodec } from '@ptp/datasets/vendors/canon/canon-event-data-dataset'
import { createCanonRegistry } from '@ptp/registry'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

function testCamera() {
    const transport = {
        isLittleEndian: () => true,
        on: () => undefined,
    } as unknown as TransportInterface
    const camera = new CanonCamera(
        transport,
        new Logger({ expanded: false, captureConsole: false, renderInTerminal: false })
    )
    const operations: string[] = []
    camera.send = (async operation => {
        operations.push(operation.name)
        return { code: 0x2001 }
    }) as typeof camera.send
    return { camera, operations }
}

describe('Canon camera controls', () => {
    it('registers typed focus and white-balance values', () => {
        const registry = createCanonRegistry(true)

        expect(registry.properties.CanonFocusMode.codec(registry).decode(registry.codecs.uint32.encode(1)).value).toBe(
            'ai-servo'
        )
        expect(registry.properties.CanonWhiteBalance.codec(registry).decode(registry.codecs.uint32.encode(23)).value).toBe(
            'auto-white'
        )
        expect(registry.properties.CanonWhiteBalance.codec(registry).encode('daylight')).toEqual(Uint8Array.of(1))
    })

    it('round-trips and sends Canon exposure values used by USB and PTP/IP', async () => {
        const { camera, operations } = testCamera()
        const registry = createCanonRegistry(true)

        expect(registry.properties.CanonIso.codec(registry).decode(registry.properties.CanonIso.codec(registry).encode('200')).value).toBe('200')
        expect(registry.properties.CanonAperture.codec(registry).decode(registry.properties.CanonAperture.codec(registry).encode('f/5.6')).value).toBe('f/5.6')
        expect(registry.properties.CanonShutterSpeed.codec(registry).decode(registry.properties.CanonShutterSpeed.codec(registry).encode('1/125')).value).toBe('1/125')

        await camera.setIso('200')
        await camera.setAperture('f/5.6')
        await camera.setShutterSpeed('1/125')

        expect(operations.filter(name => name === 'CanonSetPropValue')).toHaveLength(3)
    })

    it('drives and always releases standalone autofocus', async () => {
        const { camera, operations } = testCamera()

        await camera.autofocus(0)

        expect(operations).toEqual(['CanonDoAutofocus', 'CanonCancelAutofocus'])
    })

    it('falls back to a released half-press when direct autofocus needs live view', async () => {
        const { camera, operations } = testCamera()
        camera.send = (async operation => {
            operations.push(operation.name)
            return { code: operation.name === 'CanonDoAutofocus' ? 0x2002 : 0x2001 }
        }) as typeof camera.send

        await camera.autofocus(0)

        expect(operations).toEqual(['CanonDoAutofocus', 'CanonRemoteReleaseOn', 'CanonRemoteReleaseOff'])
    })

    it('enters and leaves movie-select mode without conflating it with recording', async () => {
        const { camera, operations } = testCamera()

        await camera.enterMovieMode()
        await camera.leaveMovieMode()

        expect(operations).toEqual(['CanonMovieSelectSwitchOn', 'CanonMovieSelectSwitchOff'])
    })

    it('round-trips Canon single and dual still-image format structures', () => {
        const registry = createCanonRegistry(true)
        const codec = new CanonImageFormatCodec(registry)

        for (const packed of [0x03ff, 0x0c03, 0x0b02]) {
            const format = canonImageFormatFromPacked(packed)
            expect(codec.decode(codec.encode(format)).value).toEqual(format)
        }
        expect(canonImageFormatFromPacked(0x0c03).label).toBe('RAW + L')
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
        const { camera } = testCamera()
        const communicationMode = camera.registry.properties.CanonNetworkCommunicationMode
        const region = camera.registry.properties.CanonNetworkServerRegion
        const wftStatus = camera.registry.properties.CanonWftStatus
        const cache = (camera as unknown as { propertyCache: Map<unknown, unknown> }).propertyCache
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
