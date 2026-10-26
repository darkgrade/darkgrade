import { CanonCamera } from '@camera/canon-camera'
import { Logger } from '@core/logger'
import { CanonLiveViewDatasetCodec, canonLiveViewPosition } from '@ptp/datasets/vendors/canon/canon-live-view-dataset'
import { createCanonRegistry } from '@ptp/registry'
import type { PropertyDefinition } from '@ptp/types/property'
import type { TransportInterface } from '@transport/interfaces/transport.interface'
import { describe, expect, it } from 'vitest'

function segment(type: number, payload: Uint8Array): Uint8Array {
    const buffer = new Uint8Array(8 + payload.length)
    const view = new DataView(buffer.buffer)
    view.setUint32(0, buffer.length, true)
    view.setUint32(4, type, true)
    buffer.set(payload, 8)
    return buffer
}

function connectedCamera(output = 'CAMERA') {
    const transport = {
        isLittleEndian: () => true,
        on: () => undefined,
        disconnect: async () => undefined,
    } as unknown as TransportInterface
    const camera = new CanonCamera(transport, new Logger({ renderInTerminal: false, captureConsole: false }))
    const cache = (
        camera as unknown as { propertyCache: Map<PropertyDefinition, { current: unknown; allowed?: unknown[] }> }
    ).propertyCache
    cache.set(camera.registry.properties.CanonLiveViewMode, { current: output })
    ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations = new Set([0x9153, 0x9158])
    const writes: number[] = []
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)
    camera.send = (async (operation, parameters, data) => {
        if (operation.code === 0x9110 && data) {
            const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
            const code = view.getUint32(4, true)
            const property = Object.values(camera.registry.properties).find(property => property.code === code)!
            const codec = typeof property.codec === 'function' ? property.codec(camera.registry) : property.codec
            cache.set(property, { ...cache.get(property), current: codec.decode(data, 8).value })
            writes.push(view.getUint32(8, true))
        }
        if (operation.code === 0x9153) return { code: 0x2001, data: { image: jpeg, segments: [] } }
        return { code: 0x2001 }
    }) as typeof camera.send
    return { camera, cache, writes, transport }
}

describe('Canon live-view framing', () => {
    const codec = new CanonLiveViewDatasetCodec(createCanonRegistry(true))
    const jpeg = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)

    it('reads the R6 III header, JPEG, unknown metadata and terminal segment with a nonzero buffer offset', () => {
        const parts = [
            segment(0xffffffff, new Uint8Array(36)),
            segment(1, jpeg),
            segment(35, new Uint8Array(84)),
            segment(0, new Uint8Array()),
        ]
        const buffer = new Uint8Array(3 + parts.reduce((length, part) => length + part.length, 0))
        let offset = 3
        for (const part of parts) {
            buffer.set(part, offset)
            offset += part.length
        }
        const result = codec.decode(buffer, 3)
        expect(result.value.image).toEqual(jpeg)
        expect(result.value.segments.map(part => part.type)).toEqual([0xffffffff, 1, 35, 0])
        expect(result.bytesRead).toBe(buffer.length - 3)
    })

    it('rejects zero-length loops, out-of-bounds lengths, partial headers and incomplete JPEGs', () => {
        for (const length of [0, 7, 100]) {
            const buffer = new Uint8Array(8)
            new DataView(buffer.buffer).setUint32(0, length, true)
            expect(() => codec.decode(buffer)).toThrow('segment length')
        }
        expect(() => codec.decode(new Uint8Array(7))).toThrow('segment header')
        expect(() => codec.decode(segment(1, Uint8Array.of(0xff, 0xd8, 0)))).toThrow('Truncated')
    })

    it('does not mistake arbitrary metadata containing JPEG markers or raw movie bytes for a JPEG frame', () => {
        expect(() => codec.decode(segment(17, jpeg))).toThrow('no JPEG')
        expect(() => codec.decode(segment(9, Uint8Array.of(1, 2, 3, 4)))).toThrow('no JPEG')
        expect(codec.decode(segment(11, jpeg)).value.image).toEqual(jpeg)
    })
})

describe('Canon viewport position readback', () => {
    const frameAt = (x: number, y: number, zoom = 5) => ({
        image: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
        segments: [
            [4, [zoom]],
            [5, [x, y]],
            [13, [x, y, 1392, 928]],
            [14, [6960, 4640]],
            [19, [0, 485, 6960, 3670]],
        ].map(([type, words]) => {
            const data = new Uint8Array((words as number[]).length * 4)
            const view = new DataView(data.buffer)
            ;(words as number[]).forEach((word, index) => view.setUint32(index * 4, word, true))
            return { type: type as number, data }
        }),
    })

    it('does not infer a position from missing, mismatched or out-of-bounds records', () => {
        expect(canonLiveViewPosition({ image: new Uint8Array(), segments: [] })).toBeUndefined()
        const mismatch = frameAt(2784, 1856)
        new DataView(mismatch.segments[2].data.buffer).setUint32(0, 100, true)
        expect(canonLiveViewPosition(mismatch)).toBeUndefined()
        expect(canonLiveViewPosition(frameAt(6960, 1856))).toBeUndefined()
    })

    it('waits past stale frames before reporting an applied position', async () => {
        const { camera } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations.add(0x9159)
        const frames = [frameAt(2784, 1856), frameAt(2784, 1856), frameAt(2584, 1856)]
        camera.captureViewfinderFrame = async () => frames.shift()!
        const landed = await camera.setLiveViewPosition(2584, 1856)
        expect(landed.x).toBe(2584)
        expect(frames).toHaveLength(0)
    })

    it('rejects out-of-bounds positions before sending an operation', async () => {
        const { camera } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations.add(0x9159)
        camera.captureViewfinderFrame = async () => frameAt(2784, 1856)
        camera.send = (async () => {
            throw new Error('Unexpected operation')
        }) as typeof camera.send
        await expect(camera.setLiveViewPosition(6960, 0)).rejects.toThrow('measured crop bounds')
        await expect(camera.setLiveViewPosition(-1, 0)).rejects.toThrow('nonnegative integers')
    })

    it('reports camera refusal and does not claim a stale position applied', async () => {
        const { camera } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations.add(0x9159)
        camera.captureViewfinderFrame = async () => frameAt(2784, 1856)
        camera.send = (async () => ({ code: 0x2005 })) as typeof camera.send
        await expect(camera.setLiveViewPosition(2584, 1856)).rejects.toThrow('position returned 0x2005')
    })

    it('sends the SDK-confirmed fourth parameter and verifies center-to-origin coordinates', async () => {
        const { camera } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations.add(0x915b)
        const frames = [frameAt(2784, 1856), frameAt(3184, 1856)]
        camera.captureViewfinderFrame = async () => frames.shift()!
        let parameters: unknown
        camera.send = (async (_, values) => {
            parameters = values
            return { code: 0x2001 }
        }) as typeof camera.send
        const position = await camera.setLiveViewFramePoint(3880, 2320)
        expect(parameters).toEqual({ Type: 3, X: 3880, Y: 2320, Lock: 0 })
        expect(position.x).toBe(3184)
    })

    it('returns the camera-rounded origin at the visible boundary', async () => {
        const { camera } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations.add(0x9159)
        const frames = [frameAt(2784, 1856), frameAt(2784, 486)]
        camera.captureViewfinderFrame = async () => frames.shift()!
        expect((await camera.setLiveViewPosition(2784, 485)).y).toBe(486)
    })

    it('does not mistake an ignored large movement for coordinate rounding', async () => {
        const { camera } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations.add(0x9159)
        camera.captureViewfinderFrame = async () => frameAt(2784, 1856)
        await expect(camera.setLiveViewPosition(2584, 1856)).rejects.toThrow('did not apply')
    })

    it('clamps pan to the visible image instead of the full sensor', async () => {
        const { camera } = connectedCamera()
        camera.captureViewfinderFrame = async () => frameAt(2784, 485)
        let target: number[] | undefined
        camera.setLiveViewPosition = async (x, y) => {
            target = [x, y]
            return canonLiveViewPosition(frameAt(x, y))!
        }
        await camera.panLiveView('up')
        expect(target).toEqual([2784, 485])
    })

    it('does not pan an unmagnified feed or accept an unknown direction', async () => {
        const { camera } = connectedCamera()
        camera.captureViewfinderFrame = async () => frameAt(2784, 1856, 1)
        await expect(camera.panLiveView('left')).rejects.toThrow('Magnify')
        await expect(camera.panLiveView('menu' as 'left')).rejects.toThrow('direction')
    })
})

describe('Canon live-view lifecycle and controls', () => {
    it('closes the transport even if restoring live-view output is rejected', async () => {
        const { camera, transport } = connectedCamera()
        await camera.captureLiveView()
        let disconnected = false
        transport.disconnect = async () => {
            disconnected = true
        }
        camera.send = (async () => ({ code: 0x2005 })) as typeof camera.send
        await expect(camera.disconnect()).rejects.toThrow('write returned 0x2005')
        expect(disconnected).toBe(true)
    })
    it('enables host output once, returns frame data and restores the previous output', async () => {
        const { camera, writes } = connectedCamera()
        expect((await camera.captureLiveView()).data).toEqual(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9))
        await camera.captureLiveView()
        await camera.stopLiveView()
        expect(writes).toEqual([3, 1])
    })

    it('starts both camera and host output from standby and restores standby', async () => {
        const {camera,writes}=connectedCamera('NONE')
        await camera.captureLiveView()
        await camera.stopLiveView()
        expect(writes).toEqual([3,0])
    })

    it('preserves host output owned by another workflow', async () => {
        const { camera, writes } = connectedCamera('HOST')
        await camera.captureLiveView()
        await camera.stopLiveView()
        expect(writes).toEqual([])
    })

    it('rejects unsupported operations before changing display output', async () => {
        const { camera, writes } = connectedCamera()
        ;(camera as unknown as { supportedOperations: Set<number> }).supportedOperations = new Set()
        await expect(camera.captureLiveView()).rejects.toThrow('not advertised')
        expect(writes).toEqual([])
    })

    it('only writes advertised temperature and AF choices and verifies readback', async () => {
        const { camera, cache } = connectedCamera()
        cache.set(camera.registry.properties.CanonColorTemperature, { current: 5200, allowed: [5200, 5300] })
        cache.set(camera.registry.properties.CanonLiveViewAutofocusMode, {
            current: 'whole-area',
            allowed: ['whole-area', 'spot'],
        })
        await expect(camera.setColorTemperature(5100)).rejects.toThrow('not advertised')
        await camera.setColorTemperature(5300)
        expect(await camera.getColorTemperature()).toBe(5300)
        await camera.setLiveViewAutofocusMode('spot')
        expect(await camera.getLiveViewAutofocusMode()).toBe('spot')
        await expect(camera.setLiveViewAutofocusMode('invented')).rejects.toThrow('not advertised')
    })

    it('surfaces rejected property writes instead of claiming success from stale cache', async () => {
        const { camera, cache } = connectedCamera()
        cache.set(camera.registry.properties.CanonColorTemperature, { current: 5200, allowed: [5200, 5300] })
        camera.send = (async () => ({ code: 0x2005 })) as typeof camera.send
        await expect(camera.setColorTemperature(5300)).rejects.toThrow('write returned 0x2005')
        expect(await camera.getColorTemperature()).toBe(5200)
    })

    it('waits past an empty event poll for a delayed aperture update', async () => {
        const { camera, cache } = connectedCamera()
        const property = camera.registry.properties.CanonAperture
        cache.set(property, { current: 'f/7.1' })
        let eventPolls = 0
        camera.send = (async operation => {
            if (operation.code !== 0x9116) return { code: 0x2001 }
            eventPolls++
            return {
                code: 0x2001,
                data:
                    eventPolls === 1
                        ? []
                        : [
                              {
                                  code: 0xc189,
                                  parameters: [property.code, 0x28],
                                  valueData: camera.registry.codecs.uint32.encode(0x28),
                              },
                          ],
            }
        }) as typeof camera.send
        await camera.setAperture('f/4')
        expect(eventPolls).toBe(2)
        expect(await camera.getAperture()).toBe('f/4')
    })

    it('uses the advertised aperture encoding when half/third stops share a display name', async () => {
        const { camera, cache } = connectedCamera()
        const property = camera.registry.properties.CanonAperture
        cache.set(property, { current: 'f/7.1', allowed: ['f/4.5'] })
        ;(
            camera as unknown as { advertisedPropertyData: Map<PropertyDefinition, Uint8Array[]> }
        ).advertisedPropertyData.set(property, [camera.registry.codecs.uint32.encode(0x2b)])
        let written: number | undefined
        camera.send = (async (operation, parameters, data) => {
            if (operation.code === 0x9110 && data)
                written = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(8, true)
            if (operation.code === 0x9116)
                return {
                    code: 0x2001,
                    data: [
                        {
                            code: 0xc189,
                            parameters: [property.code, 0x2b],
                            valueData: camera.registry.codecs.uint32.encode(0x2b),
                        },
                    ],
                }
            return { code: 0x2001 }
        }) as typeof camera.send
        await camera.setAperture('f/4.5')
        expect(written).toBe(0x2b)
        expect(await camera.getAperture()).toBe('f/4.5')
    })

    it('does not require the movie stop command to echo zero when the body reports standby', async () => {
        const { camera, cache } = connectedCamera()
        const property = camera.registry.properties.CanonRecordingDestination
        cache.set(property, { current: 'SDRAM' })
        camera.send = (async operation =>
            operation.code === 0x9116 ? { code: 0x2001, data: [] } : { code: 0x2001 }) as typeof camera.send
        await camera.stopRecording()
        expect(await camera.get(property)).toBe('SDRAM')
    })

    it('keeps reading until zoom frames reflect the new magnification', async () => {
        const { camera } = connectedCamera()
        let frames = 0
        const originalSend = camera.send.bind(camera)
        camera.send = (async (operation, parameters, data, length) => {
            if (operation.code !== 0x9153) return originalSend(operation, parameters, data, length)
            frames++
            return {
                code: 0x2001,
                data: {
                    image: Uint8Array.of(0xff, 0xd8, 0xff, 0xd9),
                    segments: [{ type: 4, data: camera.registry.codecs.uint32.encode(frames === 1 ? 1 : 5) }],
                },
            }
        }) as typeof camera.send
        await camera.setLiveViewZoom(5)
        expect(frames).toBe(2)
    })
})
