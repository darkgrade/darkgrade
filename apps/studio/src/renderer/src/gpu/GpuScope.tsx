import { animate, configureCanvas, currentFrameTexture, fitCanvas, getGpu, passTimer } from '@renderer/gpu/device'
import type { ScopeShader } from '@renderer/gpu/scope-shaders'
import { useEffect, useRef } from 'react'

/** Fraction of the remaining distance each drawn frame moves toward the latest measurement. */
const EASING_PER_FRAME = 0.22
/** Scopes redraw at most this often, a little under 30 fps so no live frame is missed. */
const DRAW_INTERVAL_MS = 30

/** One shared look for every scope: a rounded dark panel with no border. */
export const SCOPE_CANVAS_CLASS = 'w-full rounded-lg bg-black/50'

interface GpuScopeProps {
    shader: ScopeShader
    /** While false (no live view) the trace falls flat. */
    active: boolean
    className: string
    label: string
    children?: React.ReactNode
}

/**
 * A scope measured and drawn on the GPU from the shared frame texture: bins accumulate each new frame's pixels,
 * resolve into target values, and the shown values ease toward them on every draw, so nothing is read back to
 * the CPU. Only the scope on screen runs.
 */
export function GpuScope({ shader, active, className, label, children }: GpuScopeProps): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const activeRef = useRef(active)
    activeRef.current = active

    useEffect(() => {
        let stop = (): void => {}
        let cancelled = false
        void getGpu().then(gpu => {
            const canvas = canvasRef.current
            const context = gpu && canvas && configureCanvas(gpu, canvas)
            if (cancelled || !gpu || !canvas || !context) return
            const { device } = gpu
            const computeModule = device.createShaderModule({ code: shader.compute })
            const pipeline = (entryPoint: string): GPUComputePipeline =>
                device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint } })
            const accumulate = pipeline('accumulate')
            const resolve = pipeline('resolve')
            const ease = pipeline('ease')
            const drawModule = device.createShaderModule({ code: shader.draw })
            const draw = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module: drawModule, entryPoint: 'vertexMain' },
                fragment: { module: drawModule, entryPoint: 'fragmentMain', targets: [{ format: gpu.format }] },
            })
            const uniforms = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
            const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            const bins = device.createBuffer({ size: shader.bins * 4, usage: storage })
            const goal = device.createBuffer({ size: shader.values * 4, usage: storage })
            const shown = device.createBuffer({ size: shader.values * 4, usage: storage })
            const drawGroup = device.createBindGroup({
                layout: draw.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniforms } },
                    { binding: 4, resource: { buffer: shown } },
                ],
            })
            const easeGroup = device.createBindGroup({
                layout: ease.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: uniforms } },
                    { binding: 3, resource: { buffer: goal } },
                    { binding: 4, resource: { buffer: shown } },
                ],
            })
            let groups: { texture: GPUTexture; accumulate: GPUBindGroup; resolve: GPUBindGroup } | null = null
            let measuredVersion = -1
            let wasActive = true
            let lastDrawMs = 0
            const values = new Float32Array(4)
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
            const timer = passTimer(gpu, `Scope: ${label}`)

            stop = animate(`Scope: ${label}`, now => {
                if (now - lastDrawMs < DRAW_INTERVAL_MS) return
                lastDrawMs = now
                const { width, height } = fitCanvas(canvas)
                values.set([width, height, window.devicePixelRatio || 1, reduceMotion ? 1 : EASING_PER_FRAME])
                device.queue.writeBuffer(uniforms, 0, values)
                const encoder = device.createCommandEncoder()
                // The frame's first pass starts the GPU timing: measuring, when a new frame came, else easing.
                let firstPass = true
                const timed = (last: boolean): GPUComputePassTimestampWrites | undefined => {
                    const writes = timer.writes(firstPass, last)
                    firstPass = false
                    return writes
                }
                const frame = currentFrameTexture()
                if (!activeRef.current) {
                    if (wasActive) encoder.clearBuffer(goal)
                    wasActive = false
                } else if (frame && frame.version !== measuredVersion) {
                    wasActive = true
                    measuredVersion = frame.version
                    if (groups?.texture !== frame.texture) {
                        const view = frame.texture.createView()
                        groups = {
                            texture: frame.texture,
                            accumulate: device.createBindGroup({
                                layout: accumulate.getBindGroupLayout(0),
                                entries: [
                                    { binding: 1, resource: view },
                                    { binding: 2, resource: { buffer: bins } },
                                ],
                            }),
                            resolve: device.createBindGroup({
                                layout: resolve.getBindGroupLayout(0),
                                entries: [
                                    { binding: 1, resource: view },
                                    { binding: 2, resource: { buffer: bins } },
                                    { binding: 3, resource: { buffer: goal } },
                                ],
                            }),
                        }
                    }
                    encoder.clearBuffer(bins)
                    const pass = encoder.beginComputePass({ timestampWrites: timed(false) })
                    pass.setPipeline(accumulate)
                    pass.setBindGroup(0, groups.accumulate)
                    pass.dispatchWorkgroups(Math.ceil(frame.width / 16), Math.ceil(frame.height / 16))
                    pass.setPipeline(resolve)
                    pass.setBindGroup(0, groups.resolve)
                    pass.dispatchWorkgroups(shader.resolveGroups)
                    pass.end()
                }
                const easePass = encoder.beginComputePass({ timestampWrites: timed(false) })
                easePass.setPipeline(ease)
                easePass.setBindGroup(0, easeGroup)
                easePass.dispatchWorkgroups(Math.ceil(shader.values / 64))
                easePass.end()
                const pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getCurrentTexture().createView(),
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: [0, 0, 0, 0],
                        },
                    ],
                    timestampWrites: timed(true),
                })
                pass.setPipeline(draw)
                pass.setBindGroup(0, drawGroup)
                pass.draw(3)
                pass.end()
                timer.resolve(encoder)
                device.queue.submit([encoder.finish()])
                timer.collect()
            })
            const previous = stop
            stop = () => {
                previous()
                for (const buffer of [uniforms, bins, goal, shown]) buffer.destroy()
                timer.destroy()
            }
        })
        return () => {
            cancelled = true
            stop()
        }
    }, [shader, label])

    return (
        <div className={`relative ${SCOPE_CANVAS_CLASS} ${className}`}>
            <canvas ref={canvasRef} className="block size-full" role="img" aria-label={label} />
            {children}
        </div>
    )
}
