/// <reference types="@webgpu/types" />
import { subscribeToLiveFrames } from '@renderer/lib/live-frame-store'

/**
 * Studio's one WebGPU device, and the live frame on it. Each live-view JPEG is decoded once (createImageBitmap,
 * off the main thread) and copied into one texture that the picture, its assists, the scopes and the tally all
 * read on the GPU: nothing is decoded twice or read back to the CPU.
 */
export interface Gpu {
    device: GPUDevice
    format: GPUTextureFormat
}

let gpuPromise: Promise<Gpu | null> | null = null

/** The device, or null where WebGPU isn't available (the picture then falls back to a plain image). */
export function getGpu(): Promise<Gpu | null> {
    gpuPromise ??= (async () => {
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' })
        if (!adapter) return null
        const device = await adapter.requestDevice()
        device.lost.then(() => {
            gpuPromise = null
        })
        return { device, format: navigator.gpu.getPreferredCanvasFormat() }
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
        const bitmap = await createImageBitmap(blob)
        const { width, height } = bitmap
        if (!frame || frame.width !== width || frame.height !== height) {
            frame?.texture.destroy()
            const texture = gpu.device.createTexture({
                size: [width, height],
                format: 'rgba8unorm',
                usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
            })
            frame = { texture, width, height, version: frame?.version ?? 0 }
        }
        gpu.device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: frame.texture }, [width, height])
        bitmap.close()
        frame = { ...frame, version: frame.version + 1 }
        listeners.forEach(listener => listener(frame))
    } catch {
        // A frame that can't be decoded is skipped; the next one replaces it.
    } finally {
        decoding = false
        const next = pending
        pending = null
        if (next) void upload(next)
    }
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
    if (live) void upload(live.blob)
})

/** Calls draw on every display frame until the returned function stops it. */
export function animate(draw: (now: number) => void): () => void {
    let handle = requestAnimationFrame(function tick(now) {
        handle = requestAnimationFrame(tick)
        draw(now)
    })
    return () => cancelAnimationFrame(handle)
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
