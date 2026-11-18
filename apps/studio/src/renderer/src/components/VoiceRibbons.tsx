import { animate, configureCanvas, fitCanvas, FULLSCREEN_VERTEX, getGpu } from '@renderer/gpu/device'
import { useEffect, useRef } from 'react'

/**
 * Voice ribbons: five bright strands of light resting along the bottom of the voice panel that rise into moving waves
 * as you speak, on a soft haze. Each strand is drawn three times with additive blending (a wide faint glow, a tighter
 * glow, a crisp core), so where strands cross they run white-hot. The waves are three interfering waves, two running
 * against each other, so the ribbon keeps changing shape; the microphone's level lifts it and its low, mid and high
 * bands lift different strands.
 */
interface VoiceRibbonsProps {
    /** The open microphone, read every frame through its own analyser. */
    stream: MediaStream | null
    active: boolean
    /** How far above the canvas's bottom edge the strands rest, in CSS px; their glow fades out below it. */
    restOffset: number
    style?: React.CSSProperties
}

/** The strands from the outside in, in darkgrade.com's lamp: red-orange, amber, gold, pale gold, white-hot. */
const COLORS: Array<[number, number, number]> = [
    [229, 91, 33],
    [239, 141, 64],
    [246, 185, 97],
    [250, 214, 150],
    [255, 244, 224],
]
const STRANDS = 5
const LINE_WIDTH = 2.4
/** Phase between neighbouring strands, radians: how wide the ribbon fans out. */
const FAN = 0.34
/** Glow strength round each strand, and the white-hot centre's. */
const GLOW = 1.6
const HOTSPOT = 1.3
/** The tallest rise at full voice, as a share of the height; one wave's length and its travel, waves a second. */
const REACH = 0.5
const WAVELENGTH = 0.32
const SPEED = 0.55
/** The lively stretch round the centre, as a share of the width. */
const SPREAD = 0.22
/** How bright the resting line is in silence, 0–1, and the microphone's gain. */
const REST = 0.35
const SENSITIVITY = 5
const ATTACK_SECONDS = 0.03
const RELEASE_SECONDS = 0.2

const f = (value: number): string => (Number.isInteger(value) ? `${value}.0` : String(value))
const rgb = ([r, g, b]: [number, number, number]): string => `vec3f(${f(r / 255)}, ${f(g / 255)}, ${f(b / 255)})`

/**
 * The ribbons drawn per pixel on the GPU: each strand is a function of x, so a pixel measures its distance to each
 * strand directly and lights by it (a wide faint glow, a tighter glow, a crisp core, all adding toward white where
 * strands cross), over a soft haze and a warm pool, with the white-hot centre and the fades top and bottom.
 */
const RIBBONS_SHADER = /* wgsl */ `
${FULLSCREEN_VERTEX}
struct Uniforms {
    size: vec2f, pixelRatio: f32, clock: f32,
    base: f32, centre: f32, spread: f32, amplitude: f32,
    voice: f32, presence: f32, bandLow: f32, bandMid: f32,
    bandHigh: f32, pad0: f32, pad1: f32, pad2: f32,
}
@group(0) @binding(0) var<uniform> u: Uniforms;
const COLORS = array<vec3f, 5>(${COLORS.map(rgb).join(', ')});
const PI = 3.14159265;

fn band(index: i32) -> f32 {
    if (index == 0) { return u.bandLow; }
    if (index == 1) { return u.bandMid; }
    return u.bandHigh;
}

/** Strand i's height at x: three interfering waves under a bell round the lively centre, rising from the base. */
fn strandY(i: i32, x: f32) -> f32 {
    let along = 1.0 - abs(f32(i) - 2.0) / 2.0;
    let lift = u.amplitude * (0.55 + 0.45 * along) * (0.7 + 0.6 * band(i % 3));
    let phase = (f32(i) - 2.0) * ${f(FAN)};
    let k = 2.0 * PI / (u.size.x * ${f(WAVELENGTH)} * (1.0 + 0.035 * f32(i)));
    let omega = 2.0 * PI * ${f(SPEED)} * (1.0 + 0.02 * f32(i));
    let d = x - u.centre;
    let wave = 0.62 * sin(k * d - omega * u.clock + phase)
        + 0.26 * sin(k * 1.9 * d + omega * 0.7 * u.clock + phase * 1.6 + 0.8)
        + 0.22 * sin(k * 0.47 * d - omega * 0.45 * u.clock - phase * 0.7 + 2.1);
    return u.base - lift * exp(-pow(d / u.spread, 2.0)) * (0.55 + 0.45 * wave);
}

/** Brightness along the line: none at the sides, more than half a quarter in, full at the lively centre. */
fn alongLine(x: f32) -> f32 {
    let t = x / u.size.x;
    let centre = clamp(u.centre / u.size.x, 0.26, 0.74);
    if (t < 0.25) { return mix(0.0, 0.55, t / 0.25); }
    if (t < centre) { return mix(0.55, 1.0, (t - 0.25) / (centre - 0.25)); }
    if (t < 0.75) { return mix(1.0, 0.55, (t - centre) / (0.75 - centre)); }
    return mix(0.55, 0.0, (t - 0.75) / 0.25);
}

fn stroke(distance: f32, width: f32) -> f32 { return clamp(width * 0.5 - distance + 0.5 / u.pixelRatio, 0.0, 1.0); }

@fragment fn fragmentMain(v: Varyings) -> @location(0) vec4f {
    let p = v.uv * u.size;
    var light = vec3f(0.0);
    let pool = max(0.0, 1.0 - length(p - vec2f(u.centre, u.base)) / (u.spread * 1.6));
    light += COLORS[2] * 0.32 * (0.25 + u.voice) * u.presence * pool * 0.6;
    let along = alongLine(p.x);
    for (var i = 0; i < ${STRANDS}; i++) {
        let centreness = 1.0 - abs(f32(i) - 2.0) / 2.0;
        let colour = COLORS[i32(round(centreness * 4.0))];
        let y = strandY(i, p.x);
        let slope = (strandY(i, p.x + 1.0) - strandY(i, p.x - 1.0)) * 0.5;
        let distance = abs(p.y - y) / sqrt(1.0 + slope * slope);
        let strength = (${f(REST)} + (1.0 - ${f(REST)}) * min(1.0, u.voice * 1.6)) * u.presence * (0.35 + 0.65 * centreness);
        let lit = stroke(distance, ${f(LINE_WIDTH * 9)}) * ${f(0.05 * GLOW)}
            + stroke(distance, ${f(LINE_WIDTH * 3.2)}) * ${f(0.16 * GLOW)}
            + stroke(distance, ${f(LINE_WIDTH)} * (0.7 + 0.3 * centreness)) * 0.9;
        light += colour * (lit * along + 0.05 * exp(-distance * distance / 800.0)) * strength;
    }
    let hotRadius = max(1.0, u.spread * (0.35 + 0.4 * u.voice));
    let r = length(p - vec2f(u.centre, u.base)) / hotRadius;
    let hot = u.voice * u.presence * ${f(HOTSPOT)};
    if (r < 0.35) { light += mix(vec3f(1.0, 0.965, 0.894) * 0.55, vec3f(1.0, 0.863, 0.627) * 0.18, r / 0.35) * hot; }
    else if (r < 1.0) { light += vec3f(1.0, 0.863, 0.627) * 0.18 * (1.0 - (r - 0.35) / 0.65) * hot; }
    // No hard edges: below the resting line everything fades out by the bottom edge, and the top edge fades in.
    if (p.y > u.base) { light *= 1.0 - (p.y - u.base) / max(1.0, u.size.y - u.base); }
    let top = min(48.0, u.size.y * 0.2);
    if (p.y < top) { light *= p.y / top; }
    light = min(light, vec3f(1.0));
    return vec4f(light, max(light.r, max(light.g, light.b)));
}
`

interface Heard {
    level: number
    bands: [number, number, number]
}

const follow = (previous: number, target: number, dt: number): number =>
    previous + (target - previous) * (1 - Math.exp(-dt / (target > previous ? ATTACK_SECONDS : RELEASE_SECONDS)))

export function VoiceRibbons({ stream, active, restOffset, style }: VoiceRibbonsProps): React.JSX.Element {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const live = useRef({ active, restOffset })
    live.current = { active, restOffset }

    const analyserRef = useRef<AnalyserNode | null>(null)
    useEffect(() => {
        if (!stream || stream.getAudioTracks().length === 0) return
        const context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.2
        source.connect(analyser)
        analyserRef.current = analyser
        return () => {
            analyserRef.current = null
            source.disconnect()
            void context.close()
        }
    }, [stream])

    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const samples = new Float32Array(1024)
        const spectrum = new Uint8Array(512)
        const heard: Heard = { level: 0, bands: [0, 0, 0] }
        let last = performance.now()
        let clock = 0
        let stop = (): void => {}
        let cancelled = false

        // The voice's level and its low, mid and high bands, 0–1.
        const listen = (): Heard => {
            const analyser = analyserRef.current
            if (!analyser || !live.current.active) return { level: 0, bands: [0, 0, 0] }
            analyser.getFloatTimeDomainData(samples)
            let sum = 0
            for (const sample of samples) sum += sample * sample
            analyser.getByteFrequencyData(spectrum)
            const binHz = analyser.context.sampleRate / analyser.fftSize
            const band = (from: number, to: number): number => {
                let total = 0
                let count = 0
                for (let i = Math.floor(from / binHz); i <= Math.ceil(to / binHz) && i < spectrum.length; i++, count++)
                    total += spectrum[i]
                return count ? total / count / 255 : 0
            }
            return {
                level: Math.min(1, Math.sqrt(Math.sqrt(sum / samples.length)) * SENSITIVITY * 0.5),
                bands: [band(80, 300), band(300, 1500), band(1500, 5000)],
            }
        }

        void getGpu().then(gpu => {
            const context = gpu && configureCanvas(gpu, canvas)
            if (cancelled || !gpu || !context) return
            const { device } = gpu
            const module = device.createShaderModule({ code: RIBBONS_SHADER })
            const pipeline = device.createRenderPipeline({
                layout: 'auto',
                vertex: { module, entryPoint: 'vertexMain' },
                fragment: { module, entryPoint: 'fragmentMain', targets: [{ format: gpu.format }] },
            })
            const uniforms = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })
            const group = device.createBindGroup({
                layout: pipeline.getBindGroupLayout(0),
                entries: [{ binding: 0, resource: { buffer: uniforms } }],
            })
            const values = new Float32Array(16)
            let idle = false
            stop = animate(now => {
                const dt = Math.min(0.05, (now - last) / 1000)
                last = now
                clock += still ? 0 : dt
                const target = listen()
                heard.level = follow(heard.level, target.level, dt)
                heard.bands = heard.bands.map((value, band) => follow(value, target.bands[band], dt)) as Heard['bands']
                const presence = live.current.active ? 1 : 0
                // Nothing to show and nothing showing: skip the draw until the voice comes back.
                if (!presence && idle) return
                idle = !presence
                const { width: pixelWidth, height: pixelHeight } = fitCanvas(canvas)
                const ratio = window.devicePixelRatio || 1
                const width = pixelWidth / ratio
                const height = pixelHeight / ratio
                const voice = heard.level
                values.set([
                    width,
                    height,
                    ratio,
                    clock,
                    height - live.current.restOffset - LINE_WIDTH * 1.5,
                    // The lively stretch wanders along the line rather than sitting at the centre.
                    width * (0.5 + 0.14 * Math.sin(clock * 0.31) + 0.06 * Math.sin(clock * 0.83 + 1.3)),
                    width * SPREAD * (0.75 + 0.5 * voice),
                    height * REACH * voice,
                    voice,
                    presence,
                    ...heard.bands,
                    0,
                ])
                device.queue.writeBuffer(uniforms, 0, values)
                const encoder = device.createCommandEncoder()
                const pass = encoder.beginRenderPass({
                    colorAttachments: [
                        {
                            view: context.getCurrentTexture().createView(),
                            loadOp: 'clear',
                            storeOp: 'store',
                            clearValue: [0, 0, 0, 0],
                        },
                    ],
                })
                pass.setPipeline(pipeline)
                pass.setBindGroup(0, group)
                pass.draw(3)
                pass.end()
                device.queue.submit([encoder.finish()])
            })
            const previous = stop
            stop = () => {
                previous()
                uniforms.destroy()
            }
        })
        return () => {
            cancelled = true
            stop()
        }
    }, [])

    return <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', ...style }} aria-hidden />
}
