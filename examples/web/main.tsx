import './polyfills'
import './globals.css'
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { Camera } from '@api/camera'
import { useEffect, useState, useRef } from 'react'
import { CameraInfo } from '@camera/interfaces/camera.interface'
import type { ButtonHTMLAttributes } from 'react'

const downloadFile = (data: Uint8Array, filename: string, mimeType: string = 'application/octet-stream') => {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: filename })
    a.click()
    URL.revokeObjectURL(url)
}

interface ConsoleMessage {
    type: 'log' | 'warn' | 'error' | 'info'
    message: string
    timestamp: number
}

interface CapturedFrame {
    imageBitmap: ImageBitmap
    timestamp: number
    settings: {
        aperture: string
        shutterSpeed: string
        iso: string
        liveViewImageQuality: string
    }
}

const useConsoleCapture = (enabled: boolean) => {
    const [messages, setMessages] = useState<ConsoleMessage[]>([])

    useEffect(() => {
        if (!enabled) {
            setMessages([])
            return
        }

        // Store original console methods
        const originalLog = console.log
        const originalWarn = console.warn
        const originalError = console.error
        const originalInfo = console.info

        const captureMessage = (type: ConsoleMessage['type'], args: any[]) => {
            // Call original console method
            const original =
                type === 'log'
                    ? originalLog
                    : type === 'warn'
                      ? originalWarn
                      : type === 'error'
                        ? originalError
                        : originalInfo
            original.apply(console, args)

            // Capture and format message
            const message = args
                .map(arg => {
                    if (typeof arg === 'object') {
                        try {
                            return JSON.stringify(arg, null, 2)
                        } catch {
                            return String(arg)
                        }
                    }
                    return String(arg)
                })
                .join(' ')

            setMessages(prev => {
                // If we're at 10 messages, remove the oldest one before adding new
                const newMessages = prev.length >= 10 ? prev.slice(1) : prev
                return [...newMessages, { type, message, timestamp: Date.now() }]
            })
        }

        // Override console methods
        console.log = (...args) => captureMessage('log', args)
        console.warn = (...args) => captureMessage('warn', args)
        console.error = (...args) => captureMessage('error', args)
        console.info = (...args) => captureMessage('info', args)

        // Restore on unmount
        return () => {
            console.log = originalLog
            console.warn = originalWarn
            console.error = originalError
            console.info = originalInfo
        }
    }, [enabled])

    return messages
}

const useCamera = () => {
    const [camera, setCamera] = useState<Camera | null>(null)
    const cameraRef = useRef<Camera | null>(null)

    useEffect(() => {
        const camera = new Camera()
        setCamera(camera)
        cameraRef.current = camera

        // Handle page refresh/navigation
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (cameraRef.current?.isConnected()) {
                // Try to disconnect synchronously
                cameraRef.current.disconnect().catch(err => {
                    console.error('Error disconnecting camera during beforeunload:', err)
                })
            }
        }

        window.addEventListener('beforeunload', handleBeforeUnload)

        return () => {
            window.removeEventListener('beforeunload', handleBeforeUnload)

            if (camera.isConnected()) {
                camera.disconnect().catch(err => {
                    console.error('Error disconnecting camera during cleanup:', err)
                })
            }
        }
    }, [])

    return camera
}

const Button = ({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {
    return (
        <button
            className={
                "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm transition-all disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3 cursor-pointer disabled:cursor-not-allowed" +
                ' ' +
                className
            }
            {...props}
        >
            {children}
        </button>
    )
}

export default function App() {
    const camera = useCamera()
    const [showConsole, setShowConsole] = useState(false)
    const consoleMessages = useConsoleCapture(showConsole)
    const [connected, setConnected] = useState(false)
    const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null)
    const [streaming, setStreaming] = useState(false)
    const [fps, setFps] = useState(0)
    const [resolution, setResolution] = useState<{
        source: { width: number; height: number }
    } | null>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const streamingRef = useRef(false)
    const animationFrameRef = useRef<number | null>(null)
    const frameTimestamps = useRef<number[]>([])
    const lastFpsUpdate = useRef(0)
    const [settings, setSettings] = useState<{
        aperture: string
        shutterSpeed: string
        iso: string
        liveViewImageQuality: string
    } | null>(null)
    const [changedProps, setChangedProps] = useState<Set<string>>(new Set())
    const previousSettings = useRef<typeof settings>(null)
    const terminalRef = useRef<HTMLDivElement>(null)

    // Timeline and recording state
    const [isRecording, setIsRecording] = useState(false)
    const [capturedFrames, setCapturedFrames] = useState<CapturedFrame[]>([])
    const [isPlayingback, setIsPlayingback] = useState(false)
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
    const [playbackSpeed, setPlaybackSpeed] = useState(1)
    const [timelineZoom, setTimelineZoom] = useState(1) // Zoom level for timeline
    const [clipTrimStart, setClipTrimStart] = useState(0) // Start frame for trimmed clip
    const [clipTrimEnd, setClipTrimEnd] = useState(0) // End frame for trimmed clip
    const playbackAnimationFrameRef = useRef<number | null>(null)
    const playbackFrameIndexRef = useRef(0)
    const lastPlaybackTime = useRef(0)
    const maxFrames = 300 // Limit to ~10 seconds at 30fps

    // Auto-scroll terminal to bottom when new messages arrive
    useEffect(() => {
        if (terminalRef.current) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight
        }
    }, [consoleMessages])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Clean up all captured frames
            capturedFrames.forEach(frame => frame.imageBitmap.close())

            // Cancel any running animation frames
            if (playbackAnimationFrameRef.current) {
                cancelAnimationFrame(playbackAnimationFrameRef.current)
            }
        }
    }, [])

    useEffect(() => {
        const getCameraInfo = async () => {
            const info = await camera?.getCameraInfo()
            setCameraInfo(info ?? null)
        }
        getCameraInfo()
    }, [camera, connected])

    const onConnect = async () => {
        await camera?.connect()
        setConnected(true)
    }

    const onDisconnect = async () => {
        // Stop streaming and cleanup
        if (streaming) {
            stopStreaming()
        }
        await camera?.disconnect()
        setConnected(false)
    }

    const onCaptureImage = async () => {
        stopStreaming()
        await new Promise(resolve => setTimeout(resolve, 100))
        const result = await camera?.captureImage()
        if (result?.data) {
            const filename = result.info?.filename || 'captured_image.jpg'
            downloadFile(result.data, filename, 'image/jpeg')
        }
        await new Promise(resolve => setTimeout(resolve, 100))
        startStreaming()
    }

    const onCaptureLiveView = async () => {
        stopStreaming()
        await new Promise(resolve => setTimeout(resolve, 100))
        const result = await camera?.captureLiveView()
        if (result?.data) {
            const filename = result.info?.filename || 'captured_liveview.jpg'
            downloadFile(result.data, filename, 'image/jpeg')
        }
        await new Promise(resolve => setTimeout(resolve, 100))
        startStreaming()
    }

    // High-performance streaming using Canvas and requestAnimationFrame
    useEffect(() => {
        const canvas = canvasRef.current
        if (!canvas) return

        const ctx = canvas.getContext('2d')
        if (!ctx) return

        streamingRef.current = streaming

        const streamFrame = async () => {
            if (!streamingRef.current || !camera || !connected) return

            try {
                const exposureSettings = await camera.getDeviceProperty('APERTURE')
                const shutterSpeed = await camera.getDeviceProperty('SHUTTER_SPEED')
                const iso = await camera.getDeviceProperty('ISO')
                const liveViewImageQuality = await camera.getDeviceProperty('LIVE_VIEW_IMAGE_QUALITY')

                const newSettings = {
                    aperture: exposureSettings,
                    shutterSpeed: shutterSpeed,
                    iso: iso,
                    liveViewImageQuality: liveViewImageQuality,
                }

                // Track which properties changed
                if (previousSettings.current) {
                    const changed = new Set<string>()
                    if (previousSettings.current.aperture !== newSettings.aperture) changed.add('aperture')
                    if (previousSettings.current.shutterSpeed !== newSettings.shutterSpeed) changed.add('shutterSpeed')
                    if (previousSettings.current.iso !== newSettings.iso) changed.add('iso')
                    if (previousSettings.current.liveViewImageQuality !== newSettings.liveViewImageQuality)
                        changed.add('liveViewImageQuality')

                    if (changed.size > 0) {
                        setChangedProps(changed)
                        // Clear highlights after animation
                        setTimeout(() => setChangedProps(new Set()), 1000)
                    }
                }

                previousSettings.current = newSettings
                setSettings(newSettings)

                const result = await camera.streamLiveView()
                if (result && streamingRef.current) {
                    // Decode JPEG binary data directly to ImageBitmap (no URLs!)
                    const blob = new Blob([new Uint8Array(result)], { type: 'image/jpeg' })
                    const imageBitmap = await createImageBitmap(blob)

                    // Set canvas dimensions to match image
                    canvas.width = imageBitmap.width
                    canvas.height = imageBitmap.height

                    // Update resolution state
                    setResolution({
                        source: { width: imageBitmap.width, height: imageBitmap.height },
                    })

                    // Draw ImageBitmap directly to canvas
                    ctx.drawImage(imageBitmap, 0, 0)

                    // Capture frame for timeline if recording
                    if (isRecording) {
                        const frameToStore = await createImageBitmap(blob)

                        setCapturedFrames(prevFrames => {
                            const newFrame: CapturedFrame = {
                                imageBitmap: frameToStore,
                                timestamp: performance.now(),
                                settings: { ...newSettings },
                            }

                            // Circular buffer to prevent memory overflow
                            const updatedFrames = [...prevFrames, newFrame]
                            if (updatedFrames.length > maxFrames) {
                                // Clean up old frame resources
                                updatedFrames[0].imageBitmap.close()
                                return updatedFrames.slice(1)
                            }

                            // Update trim end when frames change
                            setClipTrimEnd(updatedFrames.length - 1)

                            return updatedFrames
                        })
                    }

                    // Clean up ImageBitmap resources
                    imageBitmap.close()

                    // Calculate FPS
                    const now = performance.now()
                    frameTimestamps.current.push(now)

                    // Keep only last 30 frame timestamps for rolling average
                    if (frameTimestamps.current.length > 30) {
                        frameTimestamps.current.shift()
                    }

                    // Update FPS display every 500ms
                    if (now - lastFpsUpdate.current > 500) {
                        if (frameTimestamps.current.length >= 2) {
                            const timeSpan =
                                frameTimestamps.current[frameTimestamps.current.length - 1] - frameTimestamps.current[0]
                            const currentFps = Math.round(((frameTimestamps.current.length - 1) * 1000) / timeSpan)
                            setFps(currentFps)
                        }
                        lastFpsUpdate.current = now
                    }

                    // Schedule next frame
                    if (streamingRef.current) {
                        animationFrameRef.current = requestAnimationFrame(streamFrame)
                    }
                }
            } catch (error) {
                console.error('Error capturing live view:', error)
                // Continue streaming even if one frame fails
                if (streamingRef.current) {
                    animationFrameRef.current = requestAnimationFrame(streamFrame)
                }
            }
        }

        if (streaming && connected) {
            streamFrame()
        }

        return () => {
            streamingRef.current = false
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current)
                animationFrameRef.current = null
            }
        }
    }, [streaming, connected, camera])

    const startStreaming = () => {
        setStreaming(true)
    }

    const stopStreaming = () => {
        setStreaming(false)
        streamingRef.current = false
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }
        // Reset FPS tracking and resolution
        setFps(0)
        setResolution(null)
        frameTimestamps.current = []
        lastFpsUpdate.current = 0
    }

    const onToggleLiveViewImageQuality = async () => {
        stopStreaming()
        await new Promise(resolve => setTimeout(resolve, 100))
        await camera?.setDeviceProperty(
            'LIVE_VIEW_IMAGE_QUALITY',
            settings?.liveViewImageQuality === 'HIGH' ? 'LOW' : 'HIGH'
        )
        await new Promise(resolve => setTimeout(resolve, 100))
        startStreaming()
    }

    // Timeline and playback functions
    const onToggleRecording = () => {
        setIsRecording(prev => !prev)
        if (isRecording && capturedFrames.length > 0) {
            console.log(`Recording stopped. Captured ${capturedFrames.length} frames.`)
        }
    }

    const onTogglePlayback = () => {
        if (capturedFrames.length === 0) {
            console.log('No frames to playback')
            return
        }

        if (isPlayingback) {
            console.log('Stopping playback')
            setIsPlayingback(false)
            if (playbackAnimationFrameRef.current) {
                cancelAnimationFrame(playbackAnimationFrameRef.current)
                playbackAnimationFrameRef.current = null
            }
        } else {
            console.log(`Starting playback with ${capturedFrames.length} frames`)
            stopStreaming()
            setIsPlayingback(true)
            setCurrentFrameIndex(clipTrimStart)
            playbackFrameIndexRef.current = clipTrimStart
            lastPlaybackTime.current = performance.now()
        }
    }

    // Playback effect
    useEffect(() => {
        if (!isPlayingback || capturedFrames.length === 0) {
            if (playbackAnimationFrameRef.current) {
                cancelAnimationFrame(playbackAnimationFrameRef.current)
                playbackAnimationFrameRef.current = null
            }
            return
        }

        console.log('Starting playback effect')

        const playbackFrame = () => {
            if (!isPlayingback) {
                console.log('Playback stopped, exiting animation loop')
                return
            }

            if (capturedFrames.length === 0) {
                console.log('No frames available')
                return
            }

            const canvas = canvasRef.current
            const ctx = canvas?.getContext('2d')
            if (!canvas || !ctx) {
                console.log('Canvas not available')
                return
            }

            const now = performance.now()
            const deltaTime = now - lastPlaybackTime.current

            // Control playback speed (assuming 30fps base rate)
            const targetFrameTime = 1000 / 30 / playbackSpeed

            if (deltaTime >= targetFrameTime) {
                const frameIndex = playbackFrameIndexRef.current
                const frame = capturedFrames[frameIndex]

                if (frame) {
                    console.log(`Playing frame ${frameIndex + 1}/${capturedFrames.length}`)
                    canvas.width = frame.imageBitmap.width
                    canvas.height = frame.imageBitmap.height
                    ctx.drawImage(frame.imageBitmap, 0, 0)

                    // Update settings display during playback
                    setSettings(frame.settings)

                    // Update UI state
                    setCurrentFrameIndex(frameIndex)
                }

                // Advance frame index within trim bounds
                const nextFrame = playbackFrameIndexRef.current + 1
                if (nextFrame > clipTrimEnd) {
                    // Loop back to start of trimmed section
                    playbackFrameIndexRef.current = clipTrimStart
                } else {
                    playbackFrameIndexRef.current = nextFrame
                }
                lastPlaybackTime.current = now
            }

            playbackAnimationFrameRef.current = requestAnimationFrame(playbackFrame)
        }

        playbackFrame()

        return () => {
            console.log('Cleaning up playback effect')
            if (playbackAnimationFrameRef.current) {
                cancelAnimationFrame(playbackAnimationFrameRef.current)
                playbackAnimationFrameRef.current = null
            }
        }
    }, [isPlayingback, capturedFrames.length, playbackSpeed])

    const onScrubTimeline = (frameIndex: number) => {
        if (capturedFrames.length === 0) return

        // Clamp to trim bounds
        const clampedIndex = Math.max(clipTrimStart, Math.min(frameIndex, clipTrimEnd))
        setCurrentFrameIndex(clampedIndex)
        playbackFrameIndexRef.current = clampedIndex

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        const frame = capturedFrames[clampedIndex]
        if (frame) {
            canvas.width = frame.imageBitmap.width
            canvas.height = frame.imageBitmap.height
            ctx.drawImage(frame.imageBitmap, 0, 0)
            setSettings(frame.settings)
            console.log(`Scrubbed to frame ${clampedIndex + 1}/${capturedFrames.length}`)
        }
    }

    const onClearTimeline = () => {
        // Clean up ImageBitmap resources
        capturedFrames.forEach(frame => frame.imageBitmap.close())
        setCapturedFrames([])
        setCurrentFrameIndex(0)
        setIsPlayingback(false)
        setIsRecording(false)
        setClipTrimStart(0)
        setClipTrimEnd(0)

        if (playbackAnimationFrameRef.current) {
            cancelAnimationFrame(playbackAnimationFrameRef.current)
            playbackAnimationFrameRef.current = null
        }
    }

    // Convert frame to timecode format (hh:mm:ss:ff)
    const formatTimecode = (frameIndex: number, fps: number = 30) => {
        const totalSeconds = frameIndex / fps
        const hours = Math.floor(totalSeconds / 3600)
        const minutes = Math.floor((totalSeconds % 3600) / 60)
        const seconds = Math.floor(totalSeconds % 60)
        const frames = frameIndex % fps

        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`
    }

    // Playhead dragging functionality
    const onPlayheadMouseDown = (e: React.MouseEvent) => {
        if (capturedFrames.length === 0) return

        // Get the initial timeline container reference
        const initialTimelineContainer = (e.target as HTMLElement).closest('.timeline-track-container')
        if (!initialTimelineContainer) return

        const initialRect = initialTimelineContainer.getBoundingClientRect()
        const trackLabelWidth = 64 // w-16 in Tailwind = 64px
        const borderWidth = 1 // border-r adds 1px
        const totalOffset = trackLabelWidth + borderWidth
        const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom

        const handleMouseMove = (e: MouseEvent) => {
            // Use the initial container rect, ignore vertical movement
            const relativeX = e.clientX - initialRect.left - totalOffset
            const progress = Math.max(0, Math.min(1, relativeX / clipWidth))
            const frameIndex = Math.min(Math.floor(progress * (capturedFrames.length - 1)), capturedFrames.length - 1)

            onScrubTimeline(frameIndex)
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        // Prevent default to avoid text selection
        e.preventDefault()
    }

    // Left trim handle dragging functionality
    const onLeftTrimMouseDown = (e: React.MouseEvent) => {
        if (capturedFrames.length === 0) return

        // Get the initial timeline container reference
        const initialTimelineContainer = (e.target as HTMLElement).closest('.timeline-track-container')
        if (!initialTimelineContainer) return

        const initialRect = initialTimelineContainer.getBoundingClientRect()
        const trackLabelWidth = 64 // w-16 in Tailwind = 64px
        const borderWidth = 1 // border-r adds 1px
        const totalOffset = trackLabelWidth + borderWidth
        const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom

        const handleMouseMove = (e: MouseEvent) => {
            // Use the initial container rect, ignore vertical movement
            const relativeX = e.clientX - initialRect.left - totalOffset
            const progress = Math.max(0, Math.min(1, relativeX / clipWidth))
            const frameIndex = Math.floor(progress * capturedFrames.length)

            // Ensure left trim doesn't exceed right trim
            const newLeftTrim = Math.min(frameIndex, clipTrimEnd - 1)
            setClipTrimStart(Math.max(0, newLeftTrim))
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        // Prevent default to avoid text selection
        e.preventDefault()
        e.stopPropagation()
    }

    // Right trim handle dragging functionality
    const onRightTrimMouseDown = (e: React.MouseEvent) => {
        if (capturedFrames.length === 0) return

        // Get the initial timeline container reference
        const initialTimelineContainer = (e.target as HTMLElement).closest('.timeline-track-container')
        if (!initialTimelineContainer) return

        const initialRect = initialTimelineContainer.getBoundingClientRect()
        const trackLabelWidth = 64 // w-16 in Tailwind = 64px
        const borderWidth = 1 // border-r adds 1px
        const totalOffset = trackLabelWidth + borderWidth
        const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom

        const handleMouseMove = (e: MouseEvent) => {
            // Use the initial container rect, ignore vertical movement
            const relativeX = e.clientX - initialRect.left - totalOffset
            const progress = Math.max(0, Math.min(1, relativeX / clipWidth))
            const frameIndex = Math.floor(progress * capturedFrames.length)

            // Ensure right trim doesn't go below left trim
            const newRightTrim = Math.max(frameIndex, clipTrimStart + 1)
            setClipTrimEnd(Math.min(capturedFrames.length - 1, newRightTrim))
        }

        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove)
            document.removeEventListener('mouseup', handleMouseUp)
        }

        document.addEventListener('mousemove', handleMouseMove)
        document.addEventListener('mouseup', handleMouseUp)

        // Prevent default to avoid text selection
        e.preventDefault()
        e.stopPropagation()
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
            <div className="flex flex-row items-center justify-center gap-4 flex-wrap">
                <Button onClick={connected ? onDisconnect : onConnect}>{connected ? 'Disconnect' : 'Connect'}</Button>
                <label className="flex items-center gap-2 text-sm">
                    <input
                        type="checkbox"
                        checked={showConsole}
                        onChange={e => setShowConsole(e.target.checked)}
                        className="w-4 h-4"
                    />
                    Display Console
                </label>
            </div>

            {/* Always show live view frame */}
            <div className="relative flex justify-center">
                <div className="relative border border-primary/10 rounded-md overflow-hidden bg-primary/5">
                    {streaming || isPlayingback || capturedFrames.length > 0 ? (
                        <canvas
                            ref={canvasRef}
                            className="max-w-[80vw] max-h-[60vh] block"
                            style={{
                                display: streaming || isPlayingback || capturedFrames.length > 0 ? 'block' : 'none',
                            }}
                        />
                    ) : (
                        <div className="flex items-center justify-center max-w-[80vw] max-h-[60vh] w-[640px] h-[480px] text-center text-sm text-primary/30">
                            <span>{connected ? `${cameraInfo?.manufacturer} Connected` : 'Disconnected'}</span>
                        </div>
                    )}

                    <div className="absolute top-2 left-2 flex flex-row gap-4">
                        {/* FPS meter in top left */}
                        <div className="px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono">
                            <span
                                style={{
                                    color: fps > 24 ? '#4ade8088' : fps > 15 ? '#facc1588' : '#f87171',
                                }}
                            >
                                {fps || 0}
                            </span>{' '}
                            FPS
                        </div>

                        {/* Resolution display */}
                        <div className="px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono">
                            {resolution?.source.width || '--'} × {resolution?.source.height || '--'}
                        </div>

                        {/* Live view image quality display */}
                        <div
                            className="px-2 py-1 bg-black/70 rounded text-xs font-mono cursor-pointer select-none transition-colors duration-300"
                            style={{ color: changedProps.has('liveViewImageQuality') ? '#4ade80' : '#ffffff4c' }}
                            onClick={onToggleLiveViewImageQuality}
                        >
                            {settings?.liveViewImageQuality
                                ? settings.liveViewImageQuality === 'HIGH'
                                    ? 'HQ'
                                    : 'LQ'
                                : '--'}
                        </div>
                    </div>

                    {/* Exposure settings in top right */}
                    <div className="absolute top-2 right-2 px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono flex flex-row gap-4">
                        <span
                            className="transition-colors duration-300"
                            style={{ color: changedProps.has('aperture') ? '#4ade80' : undefined }}
                        >
                            {settings?.aperture || '--'}
                        </span>
                        <span
                            className="transition-colors duration-300"
                            style={{ color: changedProps.has('shutterSpeed') ? '#4ade80' : undefined }}
                        >
                            {settings?.shutterSpeed || '--'}
                        </span>
                        <span
                            className="transition-colors duration-300"
                            style={{ color: changedProps.has('iso') ? '#4ade80' : undefined }}
                        >
                            {settings?.iso || '--'}
                        </span>
                    </div>

                    {/* Play/Pause button in bottom right */}
                    <div className="absolute bottom-2 left-2">
                        <Button
                            onClick={streaming ? stopStreaming : startStreaming}
                            disabled={!connected}
                            className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                        >
                            {streaming ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            )}
                        </Button>
                    </div>

                    <div className="absolute bottom-2 right-2 flex flex-row gap-2">
                        <Button
                            onClick={onCaptureImage}
                            disabled={!connected}
                            className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                fill="currentColor"
                                viewBox="0 0 256 256"
                            >
                                <path d="M201.54,54.46A104,104,0,0,0,54.46,201.54,104,104,0,0,0,201.54,54.46ZM190.23,65.78a88.18,88.18,0,0,1,11,13.48L167.55,119,139.63,40.78A87.34,87.34,0,0,1,190.23,65.78ZM155.59,133l-18.16,21.37-27.59-5L100.41,123l18.16-21.37,27.59,5ZM65.77,65.78a87.34,87.34,0,0,1,56.66-25.59l17.51,49L58.3,74.32A88,88,0,0,1,65.77,65.78ZM46.65,161.54a88.41,88.41,0,0,1,2.53-72.62l51.21,9.35Zm19.12,28.68a88.18,88.18,0,0,1-11-13.48L88.45,137l27.92,78.18A87.34,87.34,0,0,1,65.77,190.22Zm124.46,0a87.34,87.34,0,0,1-56.66,25.59l-17.51-49,81.64,14.91A88,88,0,0,1,190.23,190.22Zm-34.62-32.49,53.74-63.27a88.41,88.41,0,0,1-2.53,72.62Z"></path>
                            </svg>
                        </Button>

                        <Button
                            onClick={onCaptureLiveView}
                            disabled={!connected}
                            className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                fill="currentColor"
                                viewBox="0 0 256 256"
                            >
                                <path d="M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z"></path>
                            </svg>
                        </Button>

                        <Button
                            onClick={onToggleRecording}
                            disabled={!connected}
                            className={`w-8! h-8! rounded-md flex items-center justify-center text-primary/30 transition-all ${
                                isRecording ? 'bg-red-600/70! hover:bg-red-600/90!' : 'bg-black/50! hover:bg-black/70!'
                            }`}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="24"
                                height="24"
                                fill={isRecording ? '#fff' : 'var(--color-red-400)'}
                                viewBox="0 0 256 256"
                            >
                                {isRecording ? (
                                    <path d="M200,32H56A24,24,0,0,0,32,56V200a24,24,0,0,0,24,24H200a24,24,0,0,0,24-24V56A24,24,0,0,0,200,32Z" />
                                ) : (
                                    <path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm72-88a72,72,0,1,1-72-72A72.08,72.08,0,0,1,200,128Z"></path>
                                )}
                            </svg>
                        </Button>
                    </div>
                </div>
            </div>

            {/* Video Editor Timeline */}
            <div className="w-full max-w-[80vw] border border-primary/10 rounded-md bg-primary/10 overflow-hidden">
                {/* Timeline Header */}
                <div className="flex items-center justify-between px-3 py-1 border-b border-primary/10 bg-black/40">
                    <div className="flex items-center gap-4">
                        <div className="text-sm font-mono font-medium text-primary/70">
                            {formatTimecode(currentFrameIndex)}
                        </div>
                        {capturedFrames.length > 0 &&
                            (clipTrimStart > 0 || clipTrimEnd < capturedFrames.length - 1) && (
                                <div className="text-xs font-mono text-primary/50">
                                    Trim: {formatTimecode(clipTrimStart)} - {formatTimecode(clipTrimEnd)}
                                </div>
                            )}
                    </div>
                    <div className="flex items-center gap-3">
                        <Button
                            onClick={onTogglePlayback}
                            className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                            disabled={capturedFrames.length === 0}
                        >
                            {isPlayingback ? (
                                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                                </svg>
                            ) : (
                                <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M8 5v14l11-7z" />
                                </svg>
                            )}
                        </Button>
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-primary/50">Zoom:</span>
                            <input
                                type="range"
                                min={0.1}
                                max={5}
                                step={0.1}
                                value={timelineZoom}
                                onChange={e => setTimelineZoom(Number(e.target.value))}
                                className="w-16 h-1"
                            />
                            <span className="text-xs text-primary/50 w-8">{timelineZoom.toFixed(1)}x</span>
                        </div>
                    </div>
                </div>

                {/* Timeline Ruler */}
                <div className="relative h-6 bg-black/40 border-b border-primary/10">
                    {/* Left spacer to align with track content */}
                    <div className="absolute left-0 top-0 w-16 h-full=border-r border-primary/10"></div>
                    <div className="absolute left-16 top-0 right-0 flex items-center h-full text-xs text-primary/50">
                        {Array.from({ length: Math.ceil(capturedFrames.length / 30) + 1 }, (_, i) => (
                            <div
                                key={i}
                                className="flex-shrink-0 flex items-center"
                                style={{ width: `${100 * timelineZoom}px` }}
                            >
                                <span className="text-xs">{i}s</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Timeline Track */}
                <div className="relative h-20 bg-black/50 timeline-track-container">
                    {/* Track Label */}
                    <div className="absolute left-0 top-0 w-16 h-full bg-black/40 border-r border-primary/10 flex items-center justify-center">
                        <span className="text-xs text-primary/50 writing-mode-vertical transform -rotate-90">
                            Video 1
                        </span>
                    </div>

                    {/* Clip Container */}
                    <div
                        className="absolute left-16 top-2 h-16 overflow-hidden"
                        style={{
                            width: `calc(100% - 64px)`,
                            scrollBehavior: 'smooth',
                        }}
                    >
                        {/* Video Clip */}
                        <div
                            className="relative bg-primary/5 rounded h-full border border-primary/10 overflow-hidden"
                            style={{
                                width: `${(capturedFrames.length / 30) * 100 * timelineZoom}px`,
                                minWidth: '100px',
                            }}
                        >
                            {/* Left Trim Overlay */}
                            {clipTrimStart > 0 && (
                                <div
                                    className="absolute top-0 left-0 h-full bg-black/50 z-10"
                                    style={{
                                        width: `${(clipTrimStart / capturedFrames.length) * 100}%`,
                                    }}
                                ></div>
                            )}

                            {/* Right Trim Overlay */}
                            {clipTrimEnd < capturedFrames.length - 1 && (
                                <div
                                    className="absolute top-0 right-0 h-full bg-black/50 z-10"
                                    style={{
                                        width: `${((capturedFrames.length - 1 - clipTrimEnd) / capturedFrames.length) * 100}%`,
                                    }}
                                ></div>
                            )}
                            {/* Clip Preview Frames */}
                            {(() => {
                                const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom
                                const thumbnailWidth = 60 // Fixed width for thumbnails
                                const numThumbnails = Math.ceil(clipWidth / thumbnailWidth) // Use ceil to fill entirely, overflow will be clipped

                                return Array.from({ length: numThumbnails }, (_, i) => {
                                    // Calculate which frame this thumbnail represents
                                    const timePosition = (i * thumbnailWidth) / clipWidth
                                    const frameIndex = Math.floor(timePosition * capturedFrames.length)
                                    const frame = capturedFrames[frameIndex]

                                    return (
                                        <div
                                            key={`preview-${i}`}
                                            className="absolute top-0 border-r border-primary/20 overflow-hidden bg-black"
                                            style={{
                                                left: `${i * thumbnailWidth}px`,
                                                width: `${thumbnailWidth}px`,
                                                height: `calc(100% - 20px)`, // Leave space for label at bottom
                                            }}
                                        >
                                            <canvas
                                                width={frame?.imageBitmap.width || 1}
                                                height={frame?.imageBitmap.height || 1}
                                                className="w-full h-full object-cover"
                                                ref={canvas => {
                                                    if (canvas && frame) {
                                                        const ctx = canvas.getContext('2d')
                                                        if (ctx) {
                                                            canvas.width = frame.imageBitmap.width
                                                            canvas.height = frame.imageBitmap.height
                                                            ctx.drawImage(frame.imageBitmap, 0, 0)
                                                        }
                                                    }
                                                }}
                                            />
                                        </div>
                                    )
                                })
                            })()}

                            {/* Clip Label */}
                            <div className="absolute bottom-0 left-0 right-0 h-5 flex items-center justify-start pl-2 bg-primary/5 text-xs text-primary/90 font-medium">
                                Recorded Clip
                            </div>

                            {/* Left Trim Handle */}
                            <div
                                className="absolute top-0 left-0 w-2 h-full bg-primary/0 cursor-ew-resize hover:bg-primary/60 transition-colors z-20"
                                onMouseDown={onLeftTrimMouseDown}
                                style={{
                                    borderRadius: '2px 0 0 2px',
                                }}
                            ></div>

                            {/* Right Trim Handle */}
                            <div
                                className="absolute top-0 right-0 w-2 h-full bg-primary/0 cursor-ew-resize hover:bg-primary/60 transition-colors z-20"
                                onMouseDown={onRightTrimMouseDown}
                                style={{
                                    borderRadius: '0 2px 2px 0',
                                }}
                            ></div>
                        </div>
                    </div>

                    {/* Vertical Playhead */}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-primary/60 z-10 cursor-ew-resize"
                        style={{
                            left: `${64 + 1 + (currentFrameIndex / Math.max(1, capturedFrames.length - 1)) * ((capturedFrames.length / 30) * 100 * timelineZoom)}px`,
                            boxShadow: '0 0 4px rgba(0, 0, 0, 0.3)',
                        }}
                        onMouseDown={onPlayheadMouseDown}
                    >
                        {/* Playhead Handle */}
                        <div className="absolute -top-1 -left-2 w-4 h-4 bg-primary/80 rounded-full cursor-ew-resize border border-primary/40"></div>
                    </div>
                </div>
            </div>

            {/* Terminal-like console output */}
            {showConsole && (
                <div className="w-full max-w-[80vw] border border-primary/10 rounded-md bg-black/90 p-2">
                    <div
                        ref={terminalRef}
                        className="h-48 overflow-y-auto font-mono text-xs text-green-400/80"
                        style={{ scrollBehavior: 'smooth' }}
                    >
                        {consoleMessages.map((msg, index) => (
                            <div
                                key={`${msg.timestamp}-${index}`}
                                className="whitespace-pre-wrap break-words mb-1"
                                style={{
                                    color:
                                        msg.type === 'error'
                                            ? '#ef4444'
                                            : msg.type === 'warn'
                                              ? '#f59e0b'
                                              : msg.type === 'info'
                                                ? '#3b82f6'
                                                : '#4ade80cc',
                                }}
                            >
                                <span className="opacity-50">[{new Date(msg.timestamp).toLocaleTimeString()}]</span>{' '}
                                {msg.message}
                            </div>
                        ))}
                        {consoleMessages.length === 0 && (
                            <div className="text-primary/30">Console output will appear here...</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
)
