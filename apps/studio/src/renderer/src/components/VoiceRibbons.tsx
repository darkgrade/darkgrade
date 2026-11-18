import { useEffect, useRef } from 'react'

/**
 * Voice ribbons: thin strands of light that ripple with the voice, on a soft haze. The liveliness of Siri's and
 * Google's voice visuals comes from bright lines, not soft gradients alone: each strand is drawn three times with
 * additive blending (a wide faint glow, a tighter glow, a crisp core), as the recording tally's comet was, so where
 * strands cross they add up toward white. A blurred low-resolution haze underneath carries the colour.
 */
export interface VoiceRibbonsProps {
    /** The open microphone, read every frame through its own analyser. */
    stream?: MediaStream | null
    /** Or a level to follow, 0–1, sampled every frame (for previews without a microphone). */
    level?: () => number
    active?: boolean
    /** Strand colours from the outside of the ribbon in, as rgb(r, g, b); the last is the centre strand. */
    colors: string[]
    /** How many strands. */
    strands?: number
    /**
     * Where the ribbon rests, as a fraction of the height from the top. At 1 it lies along the bottom edge and the
     * waves rise from it, upward only; above that it is a centre line the waves swing both sides of.
     */
    baseline?: number
    /**
     * Anchored at the bottom: how far above the canvas's bottom edge the strands rest, in CSS px, so their glow
     * and haze can spill below the line (over a status bar) instead of being cut off at the edge.
     */
    restOffset?: number
    /** The tallest rise (or swing) at full voice, as a fraction of the height. */
    reach?: number
    /** Length of one wave, as a fraction of the width. */
    wavelength?: number
    /** How fast the waves travel, in waves a second. */
    speed?: number
    /** Width of the lively part around the centre, as a fraction of the width. */
    spread?: number
    /** Phase between neighbouring strands, in radians: small keeps the ribbon tight, large fans it out. */
    fan?: number
    /** Core line width in CSS px. */
    lineWidth?: number
    /** Strength of the glow round each strand, 0–2. */
    glow?: number
    /** Strength of the soft haze under the strands, 0–2. */
    haze?: number
    /** Brightness of the white-hot centre, 0–2. */
    hotspot?: number
    /** How bright the flat line is when silent, 0–1. */
    rest?: number
    /** Input gain for the microphone. */
    sensitivity?: number
    className?: string
    style?: React.CSSProperties
}

interface Bands {
    level: number
    low: number
    mid: number
    high: number
}

const ATTACK_SECONDS = 0.03
const RELEASE_SECONDS = 0.2
const HAZE_SCALE = 0.25

function parseRgb(color: string): [number, number, number] {
    const [r = 255, g = 255, b = 255] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number)
    return [r, g, b]
}

function follow(previous: number, target: number, dt: number): number {
    const tau = target > previous ? ATTACK_SECONDS : RELEASE_SECONDS
    return previous + (target - previous) * (1 - Math.exp(-dt / tau))
}

export function VoiceRibbons({
    stream = null,
    level,
    active = true,
    colors,
    strands = 9,
    baseline = 1,
    restOffset = 0,
    reach = 0.5,
    wavelength = 0.32,
    speed = 0.55,
    spread = 0.22,
    fan = 0.16,
    lineWidth = 1.4,
    glow = 1,
    haze = 1,
    hotspot = 1,
    rest = 0.35,
    sensitivity = 5,
    className,
    style,
}: VoiceRibbonsProps): React.JSX.Element {
    const lineRef = useRef<HTMLCanvasElement>(null)
    const hazeRef = useRef<HTMLCanvasElement>(null)
    // Settings change without restarting the loop: the loop reads the latest from here.
    const settings = useRef({
        level,
        active,
        colors,
        strands,
        baseline,
        restOffset,
        reach,
        wavelength,
        speed,
        spread,
        fan,
        lineWidth,
        glow,
        haze,
        hotspot,
        rest,
        sensitivity,
    })
    settings.current = {
        level,
        active,
        colors,
        strands,
        baseline,
        restOffset,
        reach,
        wavelength,
        speed,
        spread,
        fan,
        lineWidth,
        glow,
        haze,
        hotspot,
        rest,
        sensitivity,
    }

    // The microphone's analyser, when there is one.
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
        const lines = lineRef.current
        const hazeCanvas = hazeRef.current
        const context = lines?.getContext('2d')
        const hazeContext = hazeCanvas?.getContext('2d')
        if (!lines || !hazeCanvas || !context || !hazeContext) return
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const time = new Float32Array(1024)
        const spectrum = new Uint8Array(512)
        const heard: Bands = { level: 0, low: 0, mid: 0, high: 0 }
        let frame = 0
        let last = performance.now()
        let clock = 0

        const read = (): Bands => {
            const s = settings.current
            const analyser = analyserRef.current
            if (analyser) {
                analyser.getFloatTimeDomainData(time)
                let sum = 0
                for (const sample of time) sum += sample * sample
                const rms = Math.sqrt(sum / time.length)
                analyser.getByteFrequencyData(spectrum)
                const binHz = analyser.context.sampleRate / analyser.fftSize
                const band = (from: number, to: number) => {
                    let total = 0
                    let count = 0
                    for (let i = Math.floor(from / binHz); i <= Math.ceil(to / binHz) && i < spectrum.length; i++) {
                        total += spectrum[i]
                        count++
                    }
                    return count ? total / count / 255 : 0
                }
                const value = Math.min(1, Math.sqrt(rms) * s.sensitivity * 0.5)
                return { level: value, low: band(80, 300), mid: band(300, 1500), high: band(1500, 5000) }
            }
            const value = s.level ? Math.max(0, Math.min(1, s.level())) : 0
            // No spectrum: give the bands their own slow wobble so the strands don't move in lockstep.
            return {
                level: value,
                low: value * (0.8 + 0.2 * Math.sin(clock * 3.1)),
                mid: value * (0.7 + 0.3 * Math.sin(clock * 5.3 + 1)),
                high: value * (0.6 + 0.4 * Math.sin(clock * 8.9 + 2)),
            }
        }

        const draw = (now: number): void => {
            frame = requestAnimationFrame(draw)
            const s = settings.current
            const dt = Math.min(0.05, (now - last) / 1000)
            last = now
            clock += reducedMotion ? 0 : dt
            const target = s.active ? read() : { level: 0, low: 0, mid: 0, high: 0 }
            heard.level = follow(heard.level, target.level, dt)
            heard.low = follow(heard.low, target.low, dt)
            heard.mid = follow(heard.mid, target.mid, dt)
            heard.high = follow(heard.high, target.high, dt)

            const ratio = Math.min(2, window.devicePixelRatio || 1)
            const { width, height } = lines.getBoundingClientRect()
            if (!width || !height) return
            if (lines.width !== Math.round(width * ratio) || lines.height !== Math.round(height * ratio)) {
                lines.width = Math.round(width * ratio)
                lines.height = Math.round(height * ratio)
                hazeCanvas.width = Math.max(1, Math.round(width * HAZE_SCALE))
                hazeCanvas.height = Math.max(1, Math.round(height * HAZE_SCALE))
            }
            context.setTransform(ratio, 0, 0, ratio, 0, 0)
            context.clearRect(0, 0, width, height)
            hazeContext.setTransform(HAZE_SCALE, 0, 0, HAZE_SCALE, 0, 0)
            hazeContext.clearRect(0, 0, width, height)
            context.globalCompositeOperation = 'lighter'
            hazeContext.globalCompositeOperation = 'lighter'
            context.lineJoin = 'round'
            context.lineCap = 'round'

            const presence = s.active ? 1 : 0
            const voice = heard.level
            // Anchored at the bottom, the line sits just inside the edge so its core stays whole, and waves rise from it.
            const anchored = s.baseline >= 0.98
            const base = anchored ? height - s.restOffset - s.lineWidth * 1.5 : height * s.baseline
            // The lively part wanders along the line rather than sitting still at the centre.
            const centre = width * (0.5 + 0.14 * Math.sin(clock * 0.31) + 0.06 * Math.sin(clock * 0.83 + 1.3))
            const spreadPx = width * s.spread * (0.75 + 0.5 * voice)
            const amplitude = height * s.reach * voice
            const waveLength = width * s.wavelength
            const count = Math.max(1, s.strands)
            const palette = s.colors.map(parseRgb)
            const step = Math.max(3, Math.round(width / 360))

            // The soft haze: a few broad, faint strokes along the ribbon and a warm pool at its centre.
            const pool = hazeContext.createRadialGradient(centre, base, 0, centre, base, spreadPx * 1.6)
            const [pr, pg, pb] = palette[Math.floor(palette.length / 2)] ?? [245, 205, 138]
            pool.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, ${0.32 * s.haze * (0.25 + voice) * presence})`)
            pool.addColorStop(1, 'rgba(0, 0, 0, 0)')
            hazeContext.fillStyle = pool
            hazeContext.fillRect(0, 0, width, height)

            for (let i = 0; i < count; i++) {
                // u runs 0 at the ribbon's edges to 1 at its centre strand, which takes the last colour.
                const u = count === 1 ? 1 : 1 - Math.abs(i - (count - 1) / 2) / ((count - 1) / 2)
                const [r, g, b] = palette[Math.min(palette.length - 1, Math.round(u * (palette.length - 1)))]
                const bandLift = i % 3 === 0 ? heard.low : i % 3 === 1 ? heard.mid : heard.high
                const strandAmplitude = amplitude * (0.55 + 0.45 * u) * (0.7 + 0.6 * bandLift)
                const phase = (i - (count - 1) / 2) * s.fan
                const k = (Math.PI * 2) / (waveLength * (1 + 0.035 * i))
                const omega = Math.PI * 2 * s.speed * (1 + 0.02 * i)

                const path = new Path2D()
                for (let x = -step; x <= width + step; x += step) {
                    const envelope = Math.exp(-(((x - centre) / spreadPx) ** 2))
                    // Three waves of different lengths at different speeds, two running against each other, so the
                    // ribbon keeps changing shape (fluid) instead of one regular sine sliding along.
                    const d = x - centre
                    const wave =
                        0.62 * Math.sin(k * d - omega * clock + phase) +
                        0.26 * Math.sin(k * 1.9 * d + omega * 0.7 * clock + phase * 1.6 + 0.8) +
                        0.22 * Math.sin(k * 0.47 * d - omega * 0.45 * clock - phase * 0.7 + 2.1)
                    // From the bottom, the strands rise on a positive offset and undulate above it (never below the
                    // edge); from a centre line they swing both ways.
                    const y = anchored
                        ? base - strandAmplitude * envelope * (0.55 + 0.45 * wave)
                        : base + strandAmplitude * envelope * wave
                    if (x === -step) path.moveTo(x, y)
                    else path.lineTo(x, y)
                }
                // Each strand fades toward the panel's sides, and brightens with the voice.
                const brightness = (s.rest + (1 - s.rest) * Math.min(1, voice * 1.6)) * presence
                const along = (alpha: number): CanvasGradient => {
                    const gradient = context.createLinearGradient(0, 0, width, 0)
                    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
                    gradient.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`)
                    gradient.addColorStop(centre / width, `rgba(${r}, ${g}, ${b}, ${alpha})`)
                    gradient.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`)
                    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
                    return gradient
                }
                const lineAlpha = brightness * (0.35 + 0.65 * u)
                // Wide faint glow, tighter glow, crisp core: the comet's three strokes.
                context.lineWidth = s.lineWidth * 9
                context.strokeStyle = along(0.05 * s.glow * lineAlpha)
                context.stroke(path)
                context.lineWidth = s.lineWidth * 3.2
                context.strokeStyle = along(0.16 * s.glow * lineAlpha)
                context.stroke(path)
                context.lineWidth = s.lineWidth * (0.7 + 0.3 * u)
                context.strokeStyle = along(0.9 * lineAlpha)
                context.stroke(path)
                // The haze follows the ribbon broadly, in the strand's own colour.
                hazeContext.lineWidth = 34
                hazeContext.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.05 * s.haze * brightness})`
                hazeContext.stroke(path)
            }

            // The white-hot centre where the strands cross.
            const hot = context.createRadialGradient(centre, base, 0, centre, base, spreadPx * (0.35 + 0.4 * voice))
            hot.addColorStop(0, `rgba(255, 246, 228, ${0.55 * s.hotspot * voice * presence})`)
            hot.addColorStop(0.35, `rgba(255, 220, 160, ${0.18 * s.hotspot * voice * presence})`)
            hot.addColorStop(1, 'rgba(0, 0, 0, 0)')
            context.fillStyle = hot
            context.fillRect(0, 0, width, height)

            // No hard edges: whatever spills below the resting line fades to nothing by the canvas's bottom edge, and
            // the top edge fades in too, so neither the glow nor the haze is ever cut off by the box.
            const soften = (target: CanvasRenderingContext2D): void => {
                target.globalCompositeOperation = 'destination-out'
                const below = target.createLinearGradient(0, anchored ? base : height * 0.85, 0, height)
                below.addColorStop(0, 'rgba(0, 0, 0, 0)')
                below.addColorStop(1, 'rgba(0, 0, 0, 1)')
                target.fillStyle = below
                target.fillRect(0, anchored ? base : height * 0.85, width, height)
                const above = target.createLinearGradient(0, 0, 0, Math.min(48, height * 0.2))
                above.addColorStop(0, 'rgba(0, 0, 0, 1)')
                above.addColorStop(1, 'rgba(0, 0, 0, 0)')
                target.fillStyle = above
                target.fillRect(0, 0, width, Math.min(48, height * 0.2))
                target.globalCompositeOperation = 'source-over'
            }
            soften(context)
            soften(hazeContext)
        }
        frame = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(frame)
    }, [])

    return (
        <div className={className} style={{ position: 'relative', ...style }} aria-hidden>
            <canvas
                ref={hazeRef}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', filter: 'blur(14px)' }}
            />
            <canvas ref={lineRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        </div>
    )
}
