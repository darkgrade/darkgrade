export const store = $state<{
    connected: boolean
    streaming: boolean
    animationFrame: number | null
    fps: number
    frameTimestamps: number[]
    resolution: { width: number; height: number } | null
    canvasRef: HTMLCanvasElement | null
    settings: {
        aperture?: string
        shutterSpeed?: string
        iso?: string
    } | null
    previousSettings: {
        aperture?: string
        shutterSpeed?: string
        iso?: string
    } | null
    changedProps: Set<string>
    queueProcessing: boolean
    recording: boolean
}>({
    connected: false,
    streaming: false,
    animationFrame: null,
    fps: 0,
    frameTimestamps: [],
    resolution: null,
    canvasRef: null,
    settings: null,
    previousSettings: null,
    changedProps: new Set(),
    queueProcessing: false,
    recording: false,
})
