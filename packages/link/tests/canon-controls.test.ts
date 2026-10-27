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

    it('maps Canon documented movie audio values without confusing Disable and Auto', () => {
        const registry = createCanonRegistry(true)
        const codec = registry.properties.CanonMovieSoundRecording.codec(registry)
        expect(codec.decode(registry.codecs.uint32.encode(1)).value).toBe('disabled')
        expect(codec.decode(registry.codecs.uint32.encode(2)).value).toBe('auto')
        expect(codec.decode(registry.codecs.uint32.encode(3)).value).toBe('manual')
    })

    it('enables disabled movie audio through Manual AE and restores the previous movie exposure mode', async () => {
        const {camera} = testCamera()
        const property = camera.registry.properties.CanonMovieSoundRecording
        const cache = (camera as any).propertyCache
        cache.set(property, {current: 'disabled', allowed: ['auto', 'manual', 'disabled']})
        let mode = 22
        const writes: unknown[] = []
        camera.get = (async target => target.code === property.code ? cache.get(property).current : mode) as typeof camera.get
        camera.set = (async (target, value) => {
            writes.push([target.name, value])
            if (target.code === property.code) {expect(mode).toBe(3);cache.set(property, {...cache.get(property), current: value})}
            else mode = Number(value)
        }) as typeof camera.set
        await expect(camera.ensureMovieSoundRecording()).resolves.toBe(true)
        expect(writes).toEqual([['CanonAutoExposureMode', 3], ['CanonMovieSoundRecording', 'auto'], ['CanonAutoExposureMode', 22]])
        expect(mode).toBe(22)
        await expect(camera.ensureMovieSoundRecording()).resolves.toBe(false)
        expect(writes).toHaveLength(3)
    })

    it('preserves manual audio and rejects unadvertised automatic sound values', async () => {
        const {camera} = testCamera()
        const property = camera.registry.properties.CanonMovieSoundRecording
        const cache = (camera as any).propertyCache
        cache.set(property, {current: 'manual', allowed: ['auto', 'manual', 'disabled']})
        await expect(camera.ensureMovieSoundRecording()).resolves.toBe(false)
        cache.set(property, {current: 'disabled', allowed: ['disabled']})
        await expect(camera.ensureMovieSoundRecording()).rejects.toThrow('did not advertise')
        await expect(camera.setMovieSoundRecording('auto')).rejects.toThrow('not advertised')
    })

    it('restores exposure mode when a sound write fails and does not treat it as enabled', async () => {
        const {camera} = testCamera()
        const property = camera.registry.properties.CanonMovieSoundRecording
        ;(camera as any).propertyCache.set(property, {current: 'disabled', allowed: ['auto', 'disabled']})
        let mode = 22
        camera.get = (async () => mode) as typeof camera.get
        camera.set = (async (target, value) => {
            if (target.code === property.code) throw new Error('Audio rejected')
            mode = Number(value)
        }) as typeof camera.set
        await expect(camera.ensureMovieSoundRecording()).rejects.toThrow('Audio rejected')
        expect(mode).toBe(22)
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


describe('Canon interrupted recording Stop',()=>{
    it('accepts freshly read idle state without sending another stop write',async()=>{
        const {camera}=testCamera();let reads=0,writes=0
        const cache=(camera as any).propertyCache,property=camera.registry.properties.CanonRecordingDestination
        cache.set(property,{current:'CARD'})
        camera.send=(async()=>{reads++;cache.set(property,{current:'NONE'});return {code:0x2001,data:[]}}) as typeof camera.send
        camera.set=(async()=>{writes++}) as typeof camera.set
        await camera.stopRecording();expect(reads).toBe(1);expect(writes).toBe(0)
    })
    it('does not treat missing recording telemetry as idle',async()=>{
        const {camera}=testCamera();camera.set=(async()=>{throw new Error('Unconfirmed stop')}) as typeof camera.set
        await expect(camera.stopRecording()).rejects.toThrow('Unconfirmed stop')
    })
    it('retries busy Stop and accepts idle only after camera readback',async()=>{
        const {camera}=testCamera();const cache=(camera as any).propertyCache,property=camera.registry.properties.CanonRecordingDestination
        cache.set(property,{current:'CARD'});let writes=0,reads=0
        camera.send=(async()=>{if(++reads===2)cache.set(property,{current:'NONE'});return {code:0x2001,data:[]}}) as typeof camera.send
        camera.set=(async()=>{writes++;throw Object.assign(new Error('busy'),{code:0x2019})}) as typeof camera.set
        await camera.stopRecording();expect(writes).toBe(1);expect(reads).toBe(2)
    })
})

it('accepts EOS movie standby after reconnect without issuing Record or switching modes',async()=>{
    const {camera}=testCamera();const cache=(camera as any).propertyCache,property=camera.registry.properties.CanonRecordingDestination
    cache.set(property,{current:'SDRAM'});let writes=0
    camera.set=(async()=>{writes++}) as typeof camera.set
    camera.enterMovieMode=async()=>{throw new Error('Must not change mode')}
    await camera.stopRecording();expect(writes).toBe(0)
})

it('waits through transient Canon movie-switch busy without repeating recording',async()=>{
 const {camera}=testCamera();let attempts=0
 camera.send=(async operation=>{expect(operation.name).toBe('CanonMovieSelectSwitchOn');return {code:++attempts<3?0x2019:0x2001}}) as typeof camera.send
 await camera.enterMovieMode();expect(attempts).toBe(3)
})
it('bounds Canon movie-switch busy and rejects other errors immediately',async()=>{
 const {camera}=testCamera();let attempts=0
 camera.send=(async()=>{attempts++;return {code:0x2019}}) as typeof camera.send
 await expect(camera.enterMovieMode()).rejects.toThrow('0x2019');expect(attempts).toBe(4)
 attempts=0;camera.send=(async()=>{attempts++;return {code:0x2005}}) as typeof camera.send
 await expect(camera.enterMovieMode()).rejects.toThrow('0x2005');expect(attempts).toBe(1)
})

it('an unrecognized Canon value cannot discard later exposure properties and choices',async()=>{
 const {camera}=testCamera(),instance=camera as any
 instance.processEvents([
  {code:0xc189,parameters:[camera.registry.properties.CanonFocusMode.code,999]},
  {code:0xc189,parameters:[camera.registry.properties.CanonIso.code,0x48]},
  {code:0xc18a,parameters:[camera.registry.properties.CanonIso.code],allowedValues:[0x48,0x50,0x58]},
 ])
 const iso=(await camera.listPropertyStates()).find(property=>property.name==='CanonIso')
 expect(iso?.value).toBe('100');expect(iso?.allowedValues).toEqual(['100','200','400'])
 expect(camera.listUnknownPropertyStates().find(property=>property.code===camera.registry.properties.CanonFocusMode.code)?.rawValue).toBe(999)
})
