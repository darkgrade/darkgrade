/// <reference types="@webgpu/types" />
import { liveFeed, noteLiveFrame, subscribeToLiveFrames } from '@renderer/lib/live-frame-store'
import { perf } from '@renderer/lib/perf'

/**
 * Studio's one WebGPU device, and the live frame on it. Each live-view JPEG is decoded once (createImageBitmap,
 * off the main thread) and copied into one texture that the picture, its assists, the scopes and the tally all
 * read on the GPU: nothing is decoded twice or read back to the CPU.
 */
export interface Gpu {
    device: GPUDevice
    format: GPUTextureFormat
    /** Whether passes can be timed on the GPU (Developer Mode's performance monitor). */
    timestamps: boolean
}

let gpuPromise: Promise<Gpu | null> | null = null

/** The device, or null where WebGPU isn't available (the picture then falls back to a plain image). */
export function getGpu(): Promise<Gpu | null> {
    gpuPromise ??= (async () => {
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
        if (!adapter) return null
        const timestamps = adapter.features.has('timestamp-query')
        const device = await adapter.requestDevice({ requiredFeatures: timestamps ? ['timestamp-query'] : [] })
        device.lost.then(() => {
            gpuPromise = null
        })
        return { device, format: navigator.gpu.getPreferredCanvasFormat(), timestamps }
    })().catch(() => null)
    return gpuPromise
}

/** The latest frame as a texture; `version` changes with every new frame. */
export interface FrameTexture {
    texture: GPUTexture
    width: number
    height: number
    version: number
}

let frame: FrameTexture | null = null
let decoding = false
let pending: Blob | null = null
const listeners = new Set<(frame: FrameTexture | null) => void>()

export function currentFrameTexture(): FrameTexture | null {
    return frame
}

export function onFrameTexture(listener: (frame: FrameTexture | null) => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

/** The shared frame texture at this size, made anew when the size changes. */
function frameTarget(gpu: Gpu, width: number, height: number): FrameTexture {
    if (!frame || frame.width !== width || frame.height !== height) {
        frame?.texture.destroy()
        const texture = gpu.device.createTexture({
            size: [width, height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        })
        frame = { texture, width, height, version: frame?.version ?? 0 }
    }
    return frame
}

function publishFrame(target: FrameTexture): void {
    frame = { ...target, version: target.version + 1 }
    listeners.forEach(listener => listener(frame))
}

/**
 * A frame the Metal decoder decoded arrives as a GPU texture (an IOSurface the main process filled). A small render
 * pass draws it into the shared frame texture, converting the camera's YCbCr to RGB on the GPU, so the picture, its
 * assists and the scopes read it as they read a frame decoded here.
 */
let decodedFramePipeline: { pipeline: GPURenderPipeline; sampler: GPUSampler } | null = null
let decodedFramePipelineChecked = false
let decodedFramesFailed = false
async function drawDecodedFrame(source: { getVideoFrame(): unknown }): Promise<void> {
    // While the webcam is the feed, the camera's frames are dropped (not failed: that would switch it to JPEGs).
    if (liveFeed.get() !== 'camera') return
    const gpu = await getGpu()
    // Throwing reports that this frame wasn't drawn: after a few in a row, the main process sends JPEGs instead.
    if (!gpu || decodedFramesFailed) throw new Error('Decoded frames cannot be drawn in this window')
    const { device } = gpu
    const started = performance.now()
    const videoFrame = source.getVideoFrame() as VideoFrame
    try {
        if (!decodedFramePipeline) device.pushErrorScope('validation')
        decodedFramePipeline ??= (() => {
            const module = device.createShaderModule({
                code: /* wgsl */ `${FULLSCREEN_VERTEX}
@group(0) @binding(0) var camera: texture_external;
@group(0) @binding(1) var linearSampler: sampler;
@fragment fn fragmentMain(in: Varyings) -> @location(0) vec4f {
    return textureSampleBaseClampToEdge(camera, linearSampler, in.uv);
}`,
            })
            return {
                pipeline: device.createRenderPipeline({
                    layout: 'auto',
                    vertex: { module, entryPoint: 'vertexMain' },
                    fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: 'rgba8unorm' }] },
                }),
                sampler: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }),
            }
        })()
        if (!decodedFramePipelineChecked) {
            decodedFramePipelineChecked = true
            // A pipeline that didn't build turns this path off for good: the JPEGs are decoded here instead.
            if (await device.popErrorScope()) {
                decodedFramesFailed = true
                throw new Error('Decoded frames cannot be drawn in this window')
            }
        }
        const target = frameTarget(gpu, videoFrame.displayWidth, videoFrame.displayHeight)
        const group = device.createBindGroup({
            layout: decodedFramePipeline.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: device.importExternalTexture({ source: videoFrame }) },
                { binding: 1, resource: decodedFramePipeline.sampler },
            ],
        })
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
            colorAttachments: [
                { view: target.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] },
            ],
        })
        pass.setPipeline(decodedFramePipeline.pipeline)
        pass.setBindGroup(0, group)
        pass.draw(3)
        pass.end()
        device.queue.submit([encoder.finish()])
        perf.cpu('Live frame from the Metal decoder', performance.now() - started)
        noteLiveFrame(target.width, target.height)
        publishFrame(target)
    } finally {
        videoFrame.close()
    }
}

/** Decodes the newest JPEG into the texture; a frame that arrives mid-decode waits, and only the newest is kept. */
async function upload(blob: Blob): Promise<void> {
    if (decoding) {
        pending = blob
        return
    }
    decoding = true
    try {
        const gpu = await getGpu()
        if (!gpu) return
        const decodeStarted = performance.now()
        const bitmap = await createImageBitmap(blob)
        perf.cpu('Live frame decode', performance.now() - decodeStarted)
        const uploadStarted = performance.now()
        const { width, height } = bitmap
        const target = frameTarget(gpu, width, height)
        gpu.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: target.texture }, [width, height])
        bitmap.close()
        perf.cpu('Live frame upload to the GPU', performance.now() - uploadStarted)
        publishFrame(target)
    } catch {
        // A frame that can't be decoded is skipped; the next one replaces it.
    } finally {
        decoding = false
        const next = pending
        pending = null
        if (next) void upload(next)
    }
}

/**
 * The webcam's current frame (Developer Mode's live feed), copied from its video element into the shared frame
 * texture, so the picture, its assists, the scopes and the vision overlays read it as they read the camera's.
 */
export async function drawWebcamFrame(video: HTMLVideoElement): Promise<void> {
    const gpu = await getGpu()
    const { videoWidth: width, videoHeight: height } = video
    if (!gpu || liveFeed.get() !== 'webcam' || !width || !height) return
    const started = performance.now()
    const target = frameTarget(gpu, width, height)
    gpu.device.queue.copyExternalImageToTexture({ source: video }, { texture: target.texture }, [width, height])
    perf.cpu('Webcam frame upload to the GPU', performance.now() - started)
    noteLiveFrame(width, height)
    publishFrame(target)
}

/** The camera's own on-screen display (a PNG, about 4 a second while shown), as a texture over the picture. */
let osd: { texture: GPUTexture; version: number } | null = null
let osdDecoding = false

export function currentOsdTexture(): { texture: GPUTexture; version: number } | null {
    return osd
}

export async function publishOsdFrame(png: Uint8Array): Promise<void> {
    if (osdDecoding) return
    osdDecoding = true
    try {
        const gpu = await getGpu()
        if (!gpu) return
        const bitmap = await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' }), {
            premultiplyAlpha: 'premultiply',
        })
        if (!osd || osd.texture.width !== bitmap.width || osd.texture.height !== bitmap.height) {
            osd?.texture.destroy()
            const texture = gpu.device.createTexture({
                size: [bitmap.width, bitmap.height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            })
            osd = { texture, version: osd?.version ?? 0 }
        }
        gpu.device.queue.copyExternalImageToTexture(
            { source: bitmap },
            { texture: osd.texture, premultipliedAlpha: true },
            [bitmap.width, bitmap.height]
        )
        bitmap.close()
        osd = { ...osd, version: osd.version + 1 }
    } catch {
        // An undecodable display frame is skipped.
    } finally {
        osdDecoding = false
    }
}

subscribeToLiveFrames(live => {
    // The stand-in for a frame that arrived as a texture holds no JPEG.
    if (live && live.blob.size > 0) void upload(live.blob)
})
window.studio?.onDecodedFrame?.(drawDecodedFrame)

/**
 * Calls draw on every display frame until the returned function stops it. While the performance monitor is open, the
 * CPU time each draw takes is added under its label.
 */
export function animate(label: string, draw: (now: number) => void): () => void {
    let handle = requestAnimationFrame(function tick(now) {
        handle = requestAnimationFrame(tick)
        if (!perf.enabled) return draw(now)
        const start = performance.now()
        draw(now)
        perf.cpu(label, performance.now() - start, true)
    })
    return () => cancelAnimationFrame(handle)
}

/**
 * Times a loop's passes on the GPU for the performance monitor: the first pass of a frame writes the start, the last
 * the end, and the span is read back without waiting. Frames drawn while a reading is still on its way count at the
 * last reading's time, so the total stays the loop's whole GPU time. Does nothing where timestamps aren't available
 * or while the monitor is closed.
 */
export interface PassTimer {
    /** The timestamp writes for a pass: `first` and/or `last` of this frame's passes. */
    writes(first: boolean, last: boolean): GPURenderPassTimestampWrites | undefined
    /** After the frame's passes, before finish. */
    resolve(encoder: GPUCommandEncoder): void
    /** After submit. */
    collect(): void
    destroy(): void
}

export function passTimer(gpu: Gpu, label: string): PassTimer {
    if (!gpu.timestamps) return { writes: () => undefined, resolve: () => {}, collect: () => {}, destroy: () => {} }
    const { device } = gpu
    const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
    const resolved = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC })
    const readable = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST })
    let timing = false
    let reading = false
    let lastMs = 0
    return {
        writes(first, last) {
            if (!perf.enabled) return undefined
            if (first) {
                timing = !reading
                if (!timing && lastMs) perf.gpu(label, lastMs)
            }
            // A pass in the middle of the frame writes nothing: timestamp writes need at least one index.
            if (!timing || (!first && !last)) return undefined
            return {
                querySet,
                ...(first ? { beginningOfPassWriteIndex: 0 } : {}),
                ...(last ? { endOfPassWriteIndex: 1 } : {}),
            }
        },
        resolve(encoder) {
            if (!timing) return
            encoder.resolveQuerySet(querySet, 0, 2, resolved, 0)
            encoder.copyBufferToBuffer(resolved, 0, readable, 0, 16)
        },
        collect() {
            if (!timing) return
            timing = false
            reading = true
            readable
                .mapAsync(GPUMapMode.READ)
                .then(() => {
                    const [start, end] = new BigUint64Array(readable.getMappedRange())
                    readable.unmap()
                    const milliseconds = Number(end - start) / 1e6
                    if (milliseconds > 0 && milliseconds < 1000) {
                        lastMs = milliseconds
                        perf.gpu(label, milliseconds)
                    }
                })
                .catch(() => {})
                .finally(() => {
                    reading = false
                })
        },
        destroy() {
            querySet.destroy()
            resolved.destroy()
            readable.destroy()
        },
    }
}

/** Keeps a canvas's backing store at its CSS size times the device pixel ratio; returns its size in device px. */
export function fitCanvas(canvas: HTMLCanvasElement): { width: number; height: number } {
    const ratio = window.devicePixelRatio || 1
    const width = Math.max(1, Math.round(canvas.clientWidth * ratio))
    const height = Math.max(1, Math.round(canvas.clientHeight * ratio))
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    return { width, height }
}

/** A canvas set up for the device, with premultiplied alpha so it composites over the page. */
export function configureCanvas(gpu: Gpu, canvas: HTMLCanvasElement): GPUCanvasContext | null {
    const context = canvas.getContext('webgpu')
    context?.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied' })
    return context
}

/** A full-screen triangle; fragment shaders get `uv` 0–1 from the top left. */
export const FULLSCREEN_VERTEX = /* wgsl */ `
struct Varyings { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vertexMain(@builtin(vertex_index) index: u32) -> Varyings {
    let corner = vec2f(f32((index << 1u) & 2u), f32(index & 2u));
    var out: Varyings;
    out.position = vec4f(corner * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2f(corner.x, 1.0 - corner.y);
    return out;
}
`
