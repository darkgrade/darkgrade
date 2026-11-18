import type { PreviewAssistSettings } from '@renderer/gpu/assists'
import {
    animate,
    configureCanvas,
    currentFrameTexture,
    fitCanvas,
    getGpu,
    onFrameTexture,
    type FrameTexture,
} from '@renderer/gpu/device'
import { NOISE_SHADER, PICTURE_SHADER } from '@renderer/gpu/picture-shader'
import { useLiveFrame } from '@renderer/lib/live-frame-store'
import { useEffect, useRef, useState } from 'react'

interface LivePictureProps {
    assists: PreviewAssistSettings
    recording: boolean
    dimmed: boolean
    onAspect: (aspect: number) => void
}

/** The tally's motion: a lap of the edge, its speed swelling three times a lap, the red's slow hue sway. */
const LAP_SECONDS = 4
const SWELLS_PER_LAP = 3
const SWING = 0.33
const FADE_IN_SECONDS = 0.6
const HUE_SWAY = 5
const HUE_SECONDS = 12
/** Four slow drifts, 0 to 1 and back, on periods that never line up: [seconds one way, head start]. */
const DRIFTS: Array<[number, number]> = [
    [3.1, 0.4],
    [4.7, 2.9],
    [3.9, 1.3],
    [5.9, 4.2],
]
/** The picture's corner radius, as its frame's rounded-lg. */
const RADIUS = 10
/** Zebra stripes step along a stripe width twelve times a second. */
const ZEBRA_STEPS_PER_SECOND = 12
/** Focus peaking's threshold: the frame's noise times this, from the least (1) to the most (100) sensitive. */
const NOISE_MULTIPLE_LEAST = 14
const NOISE_MULTIPLE_MOST = 6

/**
 * The live picture on the GPU: the frame from its shared texture, with zebras, focus peaking and the recording
 * tally drawn in the same pass. Redraws only for a new frame, unless the stripes or the tally are moving.
 * Where WebGPU isn't available it falls back to a plain image without the overlays.
 */
export function LivePicture({ assists, recording, dimmed, onAspect }: LivePictureProps): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const [unavailable, setUnavailable] = useState(false)
    const live = useRef({ assists, recording, onAspect })
    live.current = { assists, recording, onAspect }
    const recordingSince = useRef<number | null>(null)
    if (recording && recordingSince.current === null) recordingSince.current = performance.now()
    if (!recording) recordingSince.current = null

    useEffect(() => {
        let stop = (): void => {}
        let cancelled = false
        void getGpu().then(gpu => {
            const canvas = canvasRef.current
            if (cancelled || !canvas) return
            const context = gpu && configureCanvas(gpu, canvas)
            if (!gpu || !context) return setUnavailable(true)
            const { device } = gpu
            const module = device.createShaderModule({ code: PICTURE_SHADER })
            const pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vertexMain' },
                fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: gpu.format }] },
            })
            const noiseModule = device.createShaderModule({ code: NOISE_SHADER })
            const binSteps = device.createComputePipeline({
                layout: 'auto',
                compute: { module: noiseModule, entryPoint: 'binSteps' },
            })
            const median = device.createComputePipeline({
                layout: 'auto',
                compute: { module: noiseModule, entryPoint: 'median' },
            })
            const uniforms = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
            const bins = device.createBuffer({
                size: 1024 * 4,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            })
            const noise = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE })
            const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
            const values = new Float32Array(20)
            let bound: { frame: GPUTexture; picture: GPUBindGroup; bin: GPUBindGroup; median: GPUBindGroup } | null =
                null
            let drawnVersion = -1
            let drawnSize = ''
            let lastZebraPhase = -1

            const bind = (frame: FrameTexture): NonNullable<typeof bound> => {
                if (bound?.frame === frame.texture) return bound
                const view = frame.texture.createView()
                bound = {
                    frame: frame.texture,
                    picture: device.createBindGroup({
                        layout: pipeline.getBindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: { buffer: uniforms } },
                            { binding: 1, resource: view },
                            { binding: 2, resource: sampler },
                            { binding: 3, resource: { buffer: noise } },
                        ],
                    }),
                    bin: device.createBindGroup({
                        layout: binSteps.getBindGroupLayout(0),
                        entries: [
                            { binding: 0, resource: view },
                            { binding: 1, resource: { buffer: bins } },
                        ],
                    }),
                    median: device.createBindGroup({
                        layout: median.getBindGroupLayout(0),
                        entries: [
                            { binding: 1, resource: { buffer: bins } },
                            { binding: 2, resource: { buffer: noise } },
                        ],
                    }),
                }
                return bound
            }

            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            stop = animate(now => {
                const frame = currentFrameTexture()
                if (!frame) return
                const { assists: settings, recording: tallyOn } = live.current
                const seconds = now / 1000
                const zebraPhase = reduceMotion ? 0 : Math.floor(seconds * ZEBRA_STEPS_PER_SECOND) % 8
                const { width, height } = fitCanvas(canvas)
                const size = `${width}x${height}`
                const moving = tallyOn || (settings.zebras && zebraPhase !== lastZebraPhase)
                if (frame.version === drawnVersion && size === drawnSize && !moving) return
                const newFrame = frame.version !== drawnVersion
                drawnVersion = frame.version
                drawnSize = size
                lastZebraPhase = zebraPhase
                const groups = bind(frame)

                const since = recordingSince.current
                const t = reduceMotion || since === null ? 0 : (now - since) / 1000
                const lap = t / LAP_SECONDS
                const swell = 2 * Math.PI * SWELLS_PER_LAP
                const sensitivity = Math.min(100, Math.max(1, settings.peakingSensitivity)) / 100
                const ratio = window.devicePixelRatio || 1
                values.set([
                    width / ratio,
                    height / ratio,
                    frame.width,
                    frame.height,
                    ratio,
                    settings.zebras ? 1 : 0,
                    (settings.zebraLevelPercent / 100) * 255,
                    zebraPhase,
                    settings.focusPeaking ? 1 : 0,
                    NOISE_MULTIPLE_LEAST - sensitivity * (NOISE_MULTIPLE_LEAST - NOISE_MULTIPLE_MOST),
                    tallyOn && since !== null ? Math.min(1, (now - since) / 1000 / FADE_IN_SECONDS) : 0,
                    360 * (lap + (SWING * Math.sin(swell * lap)) / swell),
                    -HUE_SWAY * Math.cos((2 * Math.PI * t) / HUE_SECONDS),
                    RADIUS,
                    0,
                    0,
                    ...DRIFTS.map(([period, head]) => 0.5 - 0.5 * Math.cos((Math.PI * (t + head)) / period)),
                ])
                device.queue.writeBuffer(uniforms, 0, values)

                const encoder = device.createCommandEncoder()
                if (settings.focusPeaking && newFrame) {
                    encoder.clearBuffer(bins)
                    const pass = encoder.beginComputePass()
                    pass.setPipeline(binSteps)
                    pass.setBindGroup(0, groups.bin)
                    pass.dispatchWorkgroups(Math.ceil(frame.width / 7 / 8), Math.ceil(frame.height / 8))
                    pass.setPipeline(median)
                    pass.setBindGroup(0, groups.median)
                    pass.dispatchWorkgroups(1)
                    pass.end()
                }
                const pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getCurrentTexture().createView(),
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: [0, 0, 0, 1],
                        },
                    ],
                })
                pass.setPipeline(pipeline)
                pass.setBindGroup(0, groups.picture)
                pass.draw(3)
                pass.end()
                device.queue.submit([encoder.finish()])
            })
            const unsubscribe = onFrameTexture(frame => {
                if (frame) live.current.onAspect(frame.width / frame.height)
            })
            const previous = stop
            stop = () => {
                previous()
                unsubscribe()
                uniforms.destroy()
                bins.destroy()
                noise.destroy()
            }
        })
        return () => {
            cancelled = true
            stop()
        }
    }, [])

    const fallback = useLiveFrame()
    if (unavailable)
        return fallback ? (
            <img
                className={`size-full object-contain ${dimmed ? 'opacity-40' : ''}`}
                src={fallback.url}
                alt="Live view from the camera"
            />
        ) : (
            <></>
        )
    return (
        <canvas
            ref={canvasRef}
            className={`block size-full transition-opacity duration-300 ${dimmed ? 'opacity-40' : ''}`}
            role="img"
            aria-label="Live view from the camera"
        />
    )
}
