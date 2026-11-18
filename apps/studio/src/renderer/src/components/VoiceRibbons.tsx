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
const HAZE_SCALE = 0.25

interface Heard {
    level: number
    bands: [number, number, number]
}

const follow = (previous: number, target: number, dt: number): number =>
    previous + (target - previous) * (1 - Math.exp(-dt / (target > previous ? ATTACK_SECONDS : RELEASE_SECONDS)))

export function VoiceRibbons({ stream, active, restOffset, style }: VoiceRibbonsProps): React.JSX.Element {
    const lineRef = useRef<HTMLCanvasElement>(null)
    const hazeRef = useRef<HTMLCanvasElement>(null)
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
        const lines = lineRef.current
        const hazeCanvas = hazeRef.current
        const context = lines?.getContext('2d')
        const haze = hazeCanvas?.getContext('2d')
        if (!lines || !hazeCanvas || !context || !haze) return
        const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const samples = new Float32Array(1024)
        const spectrum = new Uint8Array(512)
        const heard: Heard = { level: 0, bands: [0, 0, 0] }
        let frame = 0
        let last = performance.now()
        let clock = 0

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

        const draw = (now: number): void => {
            frame = requestAnimationFrame(draw)
            const dt = Math.min(0.05, (now - last) / 1000)
            last = now
            clock += still ? 0 : dt
            const target = listen()
            heard.level = follow(heard.level, target.level, dt)
            heard.bands = heard.bands.map((value, band) => follow(value, target.bands[band], dt)) as Heard['bands']

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
            haze.setTransform(HAZE_SCALE, 0, 0, HAZE_SCALE, 0, 0)
            haze.clearRect(0, 0, width, height)
            context.globalCompositeOperation = 'lighter'
            haze.globalCompositeOperation = 'lighter'
            context.lineJoin = 'round'
            context.lineCap = 'round'

            const presence = live.current.active ? 1 : 0
            const voice = heard.level
            const base = height - live.current.restOffset - LINE_WIDTH * 1.5
            // The lively stretch wanders along the line rather than sitting at the centre.
            const centre = width * (0.5 + 0.14 * Math.sin(clock * 0.31) + 0.06 * Math.sin(clock * 0.83 + 1.3))
            const spread = width * SPREAD * (0.75 + 0.5 * voice)
            const amplitude = height * REACH * voice
            const step = Math.max(3, Math.round(width / 360))

            // The haze: a warm pool at the centre, and broad faint strokes along each strand below.
            const [pr, pg, pb] = COLORS[2]
            const pool = haze.createRadialGradient(centre, base, 0, centre, base, spread * 1.6)
            pool.addColorStop(0, `rgba(${pr}, ${pg}, ${pb}, ${0.32 * (0.25 + voice) * presence})`)
            pool.addColorStop(1, 'rgba(0, 0, 0, 0)')
            haze.fillStyle = pool
            haze.fillRect(0, 0, width, height)

            for (let i = 0; i < STRANDS; i++) {
                // u runs from 0 at the ribbon's outside to 1 at its centre strand.
                const u = 1 - Math.abs(i - (STRANDS - 1) / 2) / ((STRANDS - 1) / 2)
                const [r, g, b] = COLORS[Math.round(u * (COLORS.length - 1))]
                const strandAmplitude = amplitude * (0.55 + 0.45 * u) * (0.7 + 0.6 * heard.bands[i % 3])
                const phase = (i - (STRANDS - 1) / 2) * FAN
                const k = (Math.PI * 2) / (width * WAVELENGTH * (1 + 0.035 * i))
                const omega = Math.PI * 2 * SPEED * (1 + 0.02 * i)
                const path = new Path2D()
                for (let x = -step; x <= width + step; x += step) {
                    const d = x - centre
                    const wave =
                        0.62 * Math.sin(k * d - omega * clock + phase) +
                        0.26 * Math.sin(k * 1.9 * d + omega * 0.7 * clock + phase * 1.6 + 0.8) +
                        0.22 * Math.sin(k * 0.47 * d - omega * 0.45 * clock - phase * 0.7 + 2.1)
                    // Rising on a positive offset, the strands undulate above the resting line, never below it.
                    const y = base - strandAmplitude * Math.exp(-((d / spread) ** 2)) * (0.55 + 0.45 * wave)
                    if (x === -step) path.moveTo(x, y)
                    else path.lineTo(x, y)
                }
                // Each strand fades toward the sides, and brightens with the voice.
                const strength = (REST + (1 - REST) * Math.min(1, voice * 1.6)) * presence * (0.35 + 0.65 * u)
                const along = (alpha: number): CanvasGradient => {
                    const gradient = context.createLinearGradient(0, 0, width, 0)
                    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`)
                    gradient.addColorStop(0.25, `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`)
                    gradient.addColorStop(centre / width, `rgba(${r}, ${g}, ${b}, ${alpha})`)
                    gradient.addColorStop(0.75, `rgba(${r}, ${g}, ${b}, ${alpha * 0.55})`)
                    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
                    return gradient
                }
                for (const [widthTimes, alpha] of [
                    [9, 0.05 * GLOW],
                    [3.2, 0.16 * GLOW],
                    [0.7 + 0.3 * u, 0.9],
                ]) {
                    context.lineWidth = LINE_WIDTH * widthTimes
                    context.strokeStyle = along(alpha * strength)
                    context.stroke(path)
                }
                haze.lineWidth = 34
                haze.strokeStyle = `rgba(${r}, ${g}, ${b}, ${0.05 * strength})`
                haze.stroke(path)
            }

            // The white-hot centre where the strands cross.
            const hot = context.createRadialGradient(centre, base, 0, centre, base, spread * (0.35 + 0.4 * voice))
            hot.addColorStop(0, `rgba(255, 246, 228, ${0.55 * HOTSPOT * voice * presence})`)
            hot.addColorStop(0.35, `rgba(255, 220, 160, ${0.18 * HOTSPOT * voice * presence})`)
            hot.addColorStop(1, 'rgba(0, 0, 0, 0)')
            context.fillStyle = hot
            context.fillRect(0, 0, width, height)

            // No hard edges: below the resting line everything fades out by the bottom edge, and the top edge fades in.
            for (const target of [context, haze]) {
                target.globalCompositeOperation = 'destination-out'
                const below = target.createLinearGradient(0, base, 0, height)
                below.addColorStop(0, 'rgba(0, 0, 0, 0)')
                below.addColorStop(1, 'rgba(0, 0, 0, 1)')
                target.fillStyle = below
                target.fillRect(0, base, width, height)
                const top = Math.min(48, height * 0.2)
                const above = target.createLinearGradient(0, 0, 0, top)
                above.addColorStop(0, 'rgba(0, 0, 0, 1)')
                above.addColorStop(1, 'rgba(0, 0, 0, 0)')
                target.fillStyle = above
                target.fillRect(0, 0, width, top)
                target.globalCompositeOperation = 'source-over'
            }
        }
        frame = requestAnimationFrame(draw)
        return () => cancelAnimationFrame(frame)
    }, [])

    const fill: React.CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' }
    return (
        <div style={{ position: 'relative', ...style }} aria-hidden>
            <canvas ref={hazeRef} style={{ ...fill, filter: 'blur(14px)' }} />
            <canvas ref={lineRef} style={fill} />
        </div>
    )
}
