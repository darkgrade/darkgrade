import './polyfills'
import './globals.css'
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { Camera } from '@api/camera'
import { useEffect, useState, useRef, useLayoutEffect } from 'react'
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

interface AudioSample {
    timestamp: number
    audioBuffer: AudioBuffer
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
    const [capturedAudio, setCapturedAudio] = useState<AudioSample[]>([])
    const [isPlayingback, setIsPlayingback] = useState(false)
    const [currentFrameIndex, setCurrentFrameIndex] = useState(0)
    const [playbackSpeed, setPlaybackSpeed] = useState(1)
    const [timelineZoom, setTimelineZoom] = useState(1) // Zoom level for timeline
    const [clipTrimStart, setClipTrimStart] = useState(0) // Start frame for trimmed clip
    const [clipTrimEnd, setClipTrimEnd] = useState(0) // End frame for trimmed clip
    const [needsScrollbar, setNeedsScrollbar] = useState(false) // Track if scrollbar is needed to prevent layout shift

    // Audio recording state
    const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
    const [selectedAudioDevice, setSelectedAudioDevice] = useState<string>('')
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null)
    const [audioContext, setAudioContext] = useState<AudioContext | null>(null)
    const [audioSource, setAudioSource] = useState<AudioBufferSourceNode | null>(null)
    const [realtimeAudioData, setRealtimeAudioData] = useState<Float32Array[]>([]) // Store audio chunks during recording
    const playbackAnimationFrameRef = useRef<number | null>(null)
    const playbackFrameIndexRef = useRef(0)
    const lastPlaybackTime = useRef(0)
    const isRecordingRef = useRef(false)
    const realtimeAudioCaptureRef = useRef<number | null>(null)
    const audioProcessorRef = useRef<ScriptProcessorNode | null>(null)
    const maxFrames = 300 // Limit to ~10 seconds at 30fps

    // Initialize audio context and get audio devices
    useEffect(() => {
        const initAudio = async () => {
            try {
                const devices = await navigator.mediaDevices.enumerateDevices()
                const audioInputs = devices.filter(device => device.kind === 'audioinput')
                setAudioDevices(audioInputs)

                if (audioInputs.length > 0) {
                    setSelectedAudioDevice(audioInputs[0].deviceId)
                }

                const context = new AudioContext()
                setAudioContext(context)
            } catch (error) {
                console.error('Error initializing audio:', error)
            }
        }

        initAudio()
    }, [])

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

            // Clean up thumbnail cache
            const thumbnailCache = thumbnailCacheRef.current
            thumbnailCache.forEach(cached => {
                cached.canvas.width = 0
                cached.canvas.height = 0
            })
            thumbnailCache.clear()

            // Clean up waveform cache
            waveformCacheRef.current = { data: null, audioLength: 0, width: 0 }

            // Clean up audio context
            if (audioContext) {
                audioContext.close()
            }

            // Stop media recorder
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop()
            }

            // Cancel any running animation frames
            if (playbackAnimationFrameRef.current) {
                cancelAnimationFrame(playbackAnimationFrameRef.current)
            }
            if (realtimeAudioCaptureRef.current) {
                cancelAnimationFrame(realtimeAudioCaptureRef.current)
            }
            if (audioProcessorRef.current) {
                audioProcessorRef.current.disconnect()
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
    const onToggleRecording = async () => {
        if (isRecording) {
            // Stop recording
            setIsRecording(false)
            isRecordingRef.current = false

            // Cancel real-time audio capture
            if (realtimeAudioCaptureRef.current) {
                cancelAnimationFrame(realtimeAudioCaptureRef.current)
                realtimeAudioCaptureRef.current = null
            }

            // Disconnect audio processor
            if (audioProcessorRef.current) {
                audioProcessorRef.current.disconnect()
                audioProcessorRef.current = null
            }

            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop()
            }
            // Clear real-time audio data
            setRealtimeAudioData([])
            console.log(
                `Recording stopped. Captured ${capturedFrames.length} frames and ${capturedAudio.length} audio samples.`
            )
        } else {
            // Start recording
            setIsRecording(true)
            isRecordingRef.current = true

            // Start audio recording if available
            if (selectedAudioDevice && audioContext) {
                try {
                    // Ensure audio context is running
                    if (audioContext.state === 'suspended') {
                        await audioContext.resume()
                    }

                    const stream = await navigator.mediaDevices.getUserMedia({
                        audio: { deviceId: selectedAudioDevice },
                    })

                    // Clear previous real-time data
                    setRealtimeAudioData([])

                    // Set up AudioWorklet for real-time audio processing
                    const processorNode = audioContext.createScriptProcessor(4096, 1, 1)
                    const gainNode = audioContext.createGain()
                    gainNode.gain.value = 0 // Mute to avoid feedback

                    const source = audioContext.createMediaStreamSource(stream)
                    source.connect(processorNode)
                    processorNode.connect(gainNode)
                    gainNode.connect(audioContext.destination)

                    audioProcessorRef.current = processorNode

                    processorNode.onaudioprocess = event => {
                        if (isRecordingRef.current) {
                            const inputData = event.inputBuffer.getChannelData(0)
                            const audioChunk = new Float32Array(inputData)

                            setRealtimeAudioData(prev => {
                                const newData = [...prev, audioChunk]
                                // Limit buffer size to prevent memory overflow
                                return newData.length > maxFrames ? newData.slice(-maxFrames) : newData
                            })
                        }
                    }

                    const recorder = new MediaRecorder(stream)
                    const audioChunks: Blob[] = []

                    recorder.ondataavailable = event => {
                        if (event.data.size > 0) {
                            audioChunks.push(event.data)
                        }
                    }

                    recorder.onstop = async () => {
                        try {
                            const audioBlob = new Blob(audioChunks, { type: 'audio/webm' })
                            const arrayBuffer = await audioBlob.arrayBuffer()
                            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

                            setCapturedAudio(prev => [
                                ...prev,
                                {
                                    timestamp: performance.now(),
                                    audioBuffer,
                                },
                            ])

                            console.log('Audio captured:', audioBuffer.duration, 'seconds')
                        } catch (error) {
                            console.error('Error processing audio:', error)
                        }

                        // Clean up stream and real-time data
                        stream.getTracks().forEach(track => track.stop())
                        source.disconnect()
                    }

                    setMediaRecorder(recorder)
                    recorder.start(100) // Collect data every 100ms
                    console.log('Audio recording started with real-time analysis')
                } catch (error) {
                    console.error('Error starting audio recording:', error)
                }
            }
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

            // Stop audio playback
            if (audioSource) {
                try {
                    audioSource.stop()
                    setAudioSource(null)
                    console.log('Audio playback stopped')
                } catch (error) {
                    console.error('Error stopping audio playback:', error)
                }
            }
        } else {
            console.log(`Starting playback with ${capturedFrames.length} frames`)
            stopStreaming()
            setIsPlayingback(true)
            setCurrentFrameIndex(clipTrimStart)
            playbackFrameIndexRef.current = clipTrimStart
            lastPlaybackTime.current = performance.now()

            // Start audio playback if available
            if (capturedAudio.length > 0 && audioContext && capturedFrames.length > 0) {
                try {
                    const audioBuffer = capturedAudio[0].audioBuffer
                    const source = audioContext.createBufferSource()
                    source.buffer = audioBuffer
                    source.connect(audioContext.destination)

                    // Calculate timing based on actual frame timestamps
                    const firstFrameTime = capturedFrames[0].timestamp
                    const lastFrameTime = capturedFrames[capturedFrames.length - 1].timestamp
                    const totalVideoTime = (lastFrameTime - firstFrameTime) / 1000 // Convert to seconds

                    // Calculate trim times based on proportional position in the recording
                    const trimStartRatio = clipTrimStart / (capturedFrames.length - 1)
                    const trimEndRatio = clipTrimEnd / (capturedFrames.length - 1)

                    const trimStartTime = trimStartRatio * audioBuffer.duration
                    const trimEndTime = trimEndRatio * audioBuffer.duration
                    const trimDuration = trimEndTime - trimStartTime

                    source.start(0, trimStartTime, trimDuration)
                    setAudioSource(source)
                    console.log('Audio playback started:', {
                        totalVideoTime,
                        audioBufferDuration: audioBuffer.duration,
                        trimStartTime,
                        trimDuration,
                    })
                } catch (error) {
                    console.error('Error starting audio playback:', error)
                }
            }
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

            // Clean up audio source
            if (audioSource) {
                try {
                    audioSource.stop()
                    setAudioSource(null)
                } catch (error) {
                    // Audio source might already be stopped
                }
            }
        }
    }, [isPlayingback, capturedFrames.length, playbackSpeed])

    const onScrubTimeline = (frameIndex: number) => {
        // Allow scrubbing to any position in timeline, even outside clip bounds
        setCurrentFrameIndex(frameIndex)
        playbackFrameIndexRef.current = frameIndex

        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return

        // Show blank/black frame if outside clip bounds or no frames exist
        if (capturedFrames.length === 0 || frameIndex < clipTrimStart || frameIndex > clipTrimEnd) {
            ctx.fillStyle = 'black'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            return
        }

        // Clamp frame index to available frames for display
        const clampedIndex = Math.max(clipTrimStart, Math.min(frameIndex, clipTrimEnd))
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
        setCapturedAudio([])
        setRealtimeAudioData([])
        setCurrentFrameIndex(0)
        setIsPlayingback(false)
        setIsRecording(false)
        isRecordingRef.current = false

        // Cancel any running animation frames
        if (realtimeAudioCaptureRef.current) {
            cancelAnimationFrame(realtimeAudioCaptureRef.current)
            realtimeAudioCaptureRef.current = null
        }

        // Disconnect audio processor
        if (audioProcessorRef.current) {
            audioProcessorRef.current.disconnect()
            audioProcessorRef.current = null
        }

        setClipTrimStart(0)
        setClipTrimEnd(0)

        // Stop any active recording
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop()
        }

        // Stop any audio playback
        if (audioSource) {
            try {
                audioSource.stop()
                setAudioSource(null)
            } catch (error) {
                // Audio source might already be stopped
            }
        }

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

    // Apply smoothing filter to waveform data
    const smoothWaveform = (waveformData: number[]): number[] => {
        if (waveformData.length < 5) return waveformData

        let smoothed = [...waveformData]
        const windowSize = 5 // Larger smoothing window

        // Apply moving average filter (multiple passes for smoother result)
        for (let pass = 0; pass < 2; pass++) {
            const passData = [...smoothed]
            for (let i = 2; i < smoothed.length - 2; i++) {
                let sum = 0
                let count = 0

                // Average with neighboring points
                for (
                    let j = Math.max(0, i - Math.floor(windowSize / 2));
                    j <= Math.min(smoothed.length - 1, i + Math.floor(windowSize / 2));
                    j++
                ) {
                    sum += passData[j]
                    count++
                }

                smoothed[i] = sum / count
            }
        }

        // Stronger exponential smoothing for more natural curves
        const alpha = 0.35 // Increased smoothing factor
        for (let i = 1; i < smoothed.length; i++) {
            smoothed[i] = alpha * smoothed[i - 1] + (1 - alpha) * smoothed[i]
        }

        // Reverse pass for bidirectional smoothing
        for (let i = smoothed.length - 2; i >= 0; i--) {
            smoothed[i] = alpha * smoothed[i + 1] + (1 - alpha) * smoothed[i]
        }

        return smoothed
    }

    // Generate waveform data from real-time audio chunks
    const generateRealtimeWaveformData = (audioChunks: Float32Array[], width: number): number[] => {
        if (audioChunks.length === 0) return []

        // Combine all audio chunks into one array
        const totalSamples = audioChunks.reduce((sum, chunk) => sum + chunk.length, 0)
        const combinedSamples = new Float32Array(totalSamples)
        let offset = 0
        for (const chunk of audioChunks) {
            combinedSamples.set(chunk, offset)
            offset += chunk.length
        }

        const samplesPerPixel = combinedSamples.length / width
        const waveformData: number[] = []

        // Find global max for normalization
        let globalMax = 0
        for (let i = 0; i < combinedSamples.length; i++) {
            globalMax = Math.max(globalMax, Math.abs(combinedSamples[i]))
        }
        if (globalMax === 0) globalMax = 1

        // Generate waveform data
        for (let i = 0; i < width; i++) {
            const start = Math.floor(i * samplesPerPixel)
            const end = Math.floor((i + 1) * samplesPerPixel)

            let max = 0
            let rms = 0
            let count = 0

            for (let j = start; j < end; j++) {
                if (j < combinedSamples.length) {
                    const sample = Math.abs(combinedSamples[j])
                    max = Math.max(max, sample)
                    rms += sample * sample
                    count++
                }
            }

            rms = count > 0 ? Math.sqrt(rms / count) : 0
            const normalizedMax = max / globalMax
            const normalizedRms = rms / globalMax

            waveformData.push(Math.max(normalizedMax * 0.3, normalizedRms))
        }

        // Apply smoothing filter
        return smoothWaveform(waveformData)
    }

    // Generate waveform data from audio buffer
    const generateWaveformData = (audioBuffer: AudioBuffer, width: number): number[] => {
        const samples = audioBuffer.getChannelData(0) // Use first channel
        const samplesPerPixel = samples.length / width
        const waveformData: number[] = []

        // First pass: find peak values for normalization
        let globalMax = 0
        for (let i = 0; i < samples.length; i++) {
            globalMax = Math.max(globalMax, Math.abs(samples[i]))
        }

        // Avoid division by zero
        if (globalMax === 0) globalMax = 1

        // Second pass: generate normalized waveform data
        for (let i = 0; i < width; i++) {
            const start = Math.floor(i * samplesPerPixel)
            const end = Math.floor((i + 1) * samplesPerPixel)

            let max = 0
            let rms = 0
            let count = 0

            for (let j = start; j < end; j++) {
                if (j < samples.length) {
                    const sample = Math.abs(samples[j])
                    max = Math.max(max, sample)
                    rms += sample * sample
                    count++
                }
            }

            // Normalize and use RMS for smoother waveform visualization
            rms = count > 0 ? Math.sqrt(rms / count) : 0
            const normalizedMax = max / globalMax // Scale to 100% of full height
            const normalizedRms = rms / globalMax

            // Blend max and RMS, normalized to full scale
            waveformData.push(Math.max(normalizedMax * 0.3, normalizedRms))
        }

        // Apply smoothing filter
        return smoothWaveform(waveformData)
    }

    // Render waveform to canvas
    const renderWaveform = (canvas: HTMLCanvasElement, waveformData: number[], width: number, height: number) => {
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        // Set canvas size with 2x pixel density for high resolution
        const pixelDensity = 2
        canvas.width = width * pixelDensity
        canvas.height = height * pixelDensity
        canvas.style.width = width + 'px'
        canvas.style.height = height + 'px'
        ctx.scale(pixelDensity, pixelDensity)

        ctx.clearRect(0, 0, width, height)

        const labelHeight = 16 // Height of the label at bottom (h-4 = 16px)
        const bottomY = height - labelHeight // Zero line right on top of label
        const maxAmplitude = height - labelHeight // Use full available height

        // Create gradient fill (80% opacity at top, 20% at bottom)
        const gradient = ctx.createLinearGradient(0, 0, 0, bottomY)
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.7)') // 80% opacity at top
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0)') // 20% opacity at bottom

        // Draw filled waveform area
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(0, bottomY)

        // Draw waveform peaks going upward from bottom
        for (let x = 0; x < waveformData.length; x++) {
            // Boost amplitude to use full height (since we normalized to 0-1 range)
            const amplitude = waveformData[x] * maxAmplitude * 2 // Double to compensate for positive-only display
            const clampedAmplitude = Math.min(amplitude, maxAmplitude) // Don't exceed available height
            ctx.lineTo(x, bottomY - clampedAmplitude)
        }

        // Connect back to bottom
        ctx.lineTo(waveformData.length - 1, bottomY)
        ctx.closePath()
        ctx.fill()

        // Draw waveform outline with crisp lines
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'
        ctx.lineWidth = 1
        ctx.imageSmoothingEnabled = false

        // Draw peak line
        ctx.beginPath()
        ctx.moveTo(0, bottomY)
        for (let x = 0; x < waveformData.length; x++) {
            // Boost amplitude to use full height (since we normalized to 0-1 range)
            const amplitude = waveformData[x] * maxAmplitude * 2 // Double to compensate for positive-only display
            const clampedAmplitude = Math.min(amplitude, maxAmplitude) // Don't exceed available height
            ctx.lineTo(x, bottomY - clampedAmplitude)
        }
        ctx.stroke()

        // Draw baseline at bottom (above label)
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(0, bottomY)
        ctx.lineTo(width, bottomY)
        ctx.stroke()
    }

    // Virtualized Canvas-based timeline rendering
    const timelineCanvasRef = useRef<HTMLCanvasElement>(null)
    const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false)
    const [isDraggingLeftTrim, setIsDraggingLeftTrim] = useState(false)
    const [isDraggingRightTrim, setIsDraggingRightTrim] = useState(false)
    
    // Viewport management for virtualization with scrolling
    const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 })
    const viewportRef = useRef({ x: 0, y: 0, width: 0, height: 0, offsetX: 0, offsetY: 0 })
    const lastRenderParams = useRef({ 
        capturedFrames: 0, 
        currentFrameIndex: -1, 
        clipTrimStart: -1, 
        clipTrimEnd: -1, 
        timelineZoom: -1, 
        viewportX: -1,
        offsetX: -1,
        isRecording: false,
        realtimeAudioDataLength: 0,
        capturedAudioLength: 0
    })
    
    // Scrolling state
    const [isDraggingTimeline, setIsDraggingTimeline] = useState(false)
    const dragStartRef = useRef({ x: 0, y: 0, offsetX: 0 })
    
    // Thumbnail cache for performance
    const thumbnailCacheRef = useRef<Map<number, { canvas: HTMLCanvasElement; timestamp: number }>>(new Map())
    const waveformCacheRef = useRef<{ data: number[] | null; audioLength: number; width: number }>({ data: null, audioLength: 0, width: 0 })
    
    // Viewport class for coordinate transformation with scrolling
    class TimelineViewport {
        x: number = 0
        y: number = 0
        width: number = 0
        height: number = 0
        zoom: number = 1
        offsetX: number = 0
        offsetY: number = 0
        
        constructor(width: number, height: number, zoom: number, offsetX: number = 0, offsetY: number = 0) {
            this.width = width
            this.height = height
            this.zoom = zoom
            this.offsetX = offsetX
            this.offsetY = offsetY
            // Viewport bounds are offset by scroll position
            this.x = offsetX
            this.y = offsetY
        }
        
        // Transform canvas coordinates to user space
        canvasToUser(canvasX: number, canvasY: number): { x: number; y: number } {
            return {
                x: canvasX + this.offsetX,
                y: canvasY + this.offsetY
            }
        }
        
        // Transform user space coordinates to canvas
        userToCanvas(userX: number, userY: number): { x: number; y: number } {
            return {
                x: userX - this.offsetX,
                y: userY - this.offsetY
            }
        }
        
        // Check if an element is visible in the viewport (accounting for scroll offset)
        isVisible(x: number, width: number): boolean {
            const viewportStart = this.offsetX
            const viewportEnd = this.offsetX + this.width
            return x + width >= viewportStart && x <= viewportEnd
        }
        
        // Get the visible portion of an element (accounting for scroll offset)
        getVisibleBounds(x: number, width: number): { x: number; width: number; clipStart: number; clipEnd: number } {
            const viewportStart = this.offsetX
            const viewportEnd = this.offsetX + this.width
            
            const startX = Math.max(x, viewportStart)
            const endX = Math.min(x + width, viewportEnd)
            const visibleWidth = Math.max(0, endX - startX)
            
            return {
                x: startX,
                width: visibleWidth,
                clipStart: Math.max(0, (startX - x) / width),
                clipEnd: Math.min(1, (endX - x) / width)
            }
        }
        
        // Get the maximum scrollable width based on content
        getMaxScrollX(contentWidth: number): number {
            return Math.max(0, contentWidth - this.width)
        }
    }
    
    // Optimized thumbnail renderer with caching
    const getCachedThumbnail = (frameIndex: number, frame: CapturedFrame, targetWidth: number, targetHeight: number): HTMLCanvasElement => {
        const cache = thumbnailCacheRef.current
        const cacheKey = frameIndex
        const cached = cache.get(cacheKey)
        
        // Check if cached thumbnail is still valid
        if (cached && cached.timestamp === frame.timestamp) {
            return cached.canvas
        }
        
        // Create new thumbnail
        const thumbnailCanvas = document.createElement('canvas')
        thumbnailCanvas.width = targetWidth
        thumbnailCanvas.height = targetHeight
        const thumbnailCtx = thumbnailCanvas.getContext('2d')
        
        if (thumbnailCtx && frame.imageBitmap) {
            // Calculate aspect ratio fit
            const aspectRatio = frame.imageBitmap.width / frame.imageBitmap.height
            const targetAspectRatio = targetWidth / targetHeight
            
            let drawWidth = targetWidth
            let drawHeight = targetHeight
            let offsetX = 0
            let offsetY = 0
            
            if (aspectRatio > targetAspectRatio) {
                drawHeight = targetWidth / aspectRatio
                offsetY = (targetHeight - drawHeight) / 2
            } else {
                drawWidth = targetHeight * aspectRatio
                offsetX = (targetWidth - drawWidth) / 2
            }
            
            thumbnailCtx.fillStyle = 'rgba(0, 0, 0, 0.2)'
            thumbnailCtx.fillRect(0, 0, targetWidth, targetHeight)
            thumbnailCtx.drawImage(frame.imageBitmap, offsetX, offsetY, drawWidth, drawHeight)
        }
        
        // Cache the thumbnail (limit cache size)
        if (cache.size > 50) {
            const oldestKey = cache.keys().next().value
            if (oldestKey !== undefined) {
                const oldest = cache.get(oldestKey)
                if (oldest) {
                    oldest.canvas.width = 0
                    oldest.canvas.height = 0
                }
                cache.delete(oldestKey)
            }
        }
        
        cache.set(cacheKey, { canvas: thumbnailCanvas, timestamp: frame.timestamp })
        return thumbnailCanvas
    }
    
    const renderTimelineCanvas = () => {
        const canvas = timelineCanvasRef.current
        if (!canvas) return
        
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        
        // Set canvas size with high DPI (only resize if actually changed)
        const rect = canvas.getBoundingClientRect()
        const pixelRatio = window.devicePixelRatio || 1
        const targetWidth = rect.width * pixelRatio
        const targetHeight = rect.height * pixelRatio
        
        // Only resize canvas if dimensions actually changed (prevents flickering)
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
            canvas.width = targetWidth
            canvas.height = targetHeight
        }
        
        // Always reset transform to ensure consistent state
        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0)
        
        // Timeline dimensions
        const trackLabelWidth = 64
        const videoTrackHeight = 80
        const audioTrackHeight = 80
        const totalHeight = videoTrackHeight + audioTrackHeight
        const timecodeHeight = 20
        const topPadding = timecodeHeight
        
        // Calculate timeline width (always show at least 30 seconds)
        const minTimelineDuration = 30
        const actualDuration = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDuration
        const timelineDuration = Math.max(minTimelineDuration, actualDuration)
        const timelineWidth = timelineDuration * 100 * timelineZoom
        const clipWidth = capturedFrames.length > 0 ? (capturedFrames.length / 30) * 100 * timelineZoom : 0
        
        // Create viewport with scroll offset
        const viewport = new TimelineViewport(rect.width, rect.height, timelineZoom, viewportOffset.x, viewportOffset.y)
        viewportRef.current = { 
            x: viewportOffset.x, 
            y: viewportOffset.y, 
            width: rect.width, 
            height: rect.height, 
            offsetX: viewportOffset.x, 
            offsetY: viewportOffset.y 
        }
        
        // Calculate content dimensions for scrolling (use timeline width, not clip width)
        const contentWidth = trackLabelWidth + timelineWidth
        const maxScrollX = viewport.getMaxScrollX(contentWidth)
        
        // Check if we need to re-render (performance optimization)
        const currentParams = {
            capturedFrames: capturedFrames.length,
            currentFrameIndex,
            clipTrimStart,
            clipTrimEnd,
            timelineZoom,
            viewportX: viewport.x,
            offsetX: viewportOffset.x,
            isRecording, // Add recording state to cache params
            realtimeAudioDataLength: realtimeAudioData.length, // Add realtime audio changes
            capturedAudioLength: capturedAudio.length // Add captured audio changes
        }
        
        const paramsChanged = Object.keys(currentParams).some(key => 
            lastRenderParams.current[key as keyof typeof currentParams] !== currentParams[key as keyof typeof currentParams]
        )
        
        // Always redraw if no frames exist or if dimensions changed to prevent disappearing
        if (!paramsChanged && capturedFrames.length > 0 && canvas.width === targetWidth && canvas.height === targetHeight) {
            // Only redraw playhead if nothing else changed
            drawPlayheadScrolled(ctx, trackLabelWidth, topPadding + totalHeight, viewportOffset.x)
            return
        }
        
        lastRenderParams.current = currentParams
        
        // Clear the entire canvas
        ctx.clearRect(0, 0, rect.width, rect.height)
        
        // Draw background for tracks (full timeline width)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'
        const trackWorldWidth = timelineWidth + trackLabelWidth
        const trackScreenX = -viewportOffset.x
        ctx.fillRect(trackScreenX, topPadding, trackWorldWidth, totalHeight)
        
        // Draw timecode ruler background (full timeline width)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'
        const rulerWorldWidth = timelineWidth + trackLabelWidth
        const rulerScreenX = -viewportOffset.x
        const rulerScreenWidth = rulerWorldWidth
        ctx.fillRect(rulerScreenX, 0, rulerScreenWidth, timecodeHeight)
        
        // Always draw timecode markers (ruler)
        // Use the timeline duration calculated above
        const totalDuration = timelineDuration
        
        const pixelsPerSecond = 100 * timelineZoom
        const secondInterval = Math.max(1, Math.floor(1 / timelineZoom))
        
        // Calculate visible time range (accounting for scroll offset)
        const visibleStartSecond = Math.floor(Math.max(0, (viewport.offsetX - trackLabelWidth) / pixelsPerSecond))
        const visibleEndSecond = Math.ceil(Math.min(totalDuration, (viewport.offsetX + viewport.width - trackLabelWidth) / pixelsPerSecond))
        
        ctx.fillStyle = 'rgba(99, 102, 241, 0.6)'
        ctx.font = '10px monospace'
        ctx.textAlign = 'left'
        
        for (let second = Math.floor(visibleStartSecond / secondInterval) * secondInterval; second <= visibleEndSecond; second += secondInterval) {
            const worldX = trackLabelWidth + (second * pixelsPerSecond)
            const screenX = worldX - viewportOffset.x
            
            if (screenX >= trackLabelWidth && screenX <= rect.width) {
                // Draw tick mark
                ctx.strokeStyle = 'rgba(99, 102, 241, 0.4)'
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(screenX, 0)
                ctx.lineTo(screenX, timecodeHeight)
                ctx.stroke()
                
                // Draw timecode
                const minutes = Math.floor(second / 60)
                const secs = second % 60
                const timecode = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
                ctx.fillText(timecode, screenX + 4, timecodeHeight - 4)
            }
        }
        
        // Draw track labels (always visible)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.4)'
        ctx.fillRect(0, topPadding, trackLabelWidth, videoTrackHeight)
        ctx.fillRect(0, topPadding + videoTrackHeight, trackLabelWidth, audioTrackHeight)
        
        // Draw track separators
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.1)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(trackLabelWidth, topPadding)
        ctx.lineTo(trackLabelWidth, topPadding + totalHeight)
        ctx.moveTo(0, topPadding + videoTrackHeight)
        ctx.lineTo(rect.width, topPadding + videoTrackHeight)
        ctx.stroke()
        
        // Draw track labels text
        ctx.fillStyle = 'rgba(99, 102, 241, 0.5)'
        ctx.font = '12px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('V1', trackLabelWidth / 2, topPadding + videoTrackHeight / 2 + 4)
        ctx.fillText('A1', trackLabelWidth / 2, topPadding + videoTrackHeight + audioTrackHeight / 2 + 4)
        
        // Draw clips if they exist
        if (capturedFrames.length > 0 && clipWidth > 0) {
            const clipMargin = 2
            const clipScreenX = trackLabelWidth - viewportOffset.x
            
            // Only draw if any part of clip is visible
            if (clipScreenX + clipWidth > trackLabelWidth && clipScreenX < rect.width) {
                // Draw video track clip with scrolling
                drawVideoClipScrolled(ctx, clipScreenX, topPadding + clipMargin, clipWidth, videoTrackHeight - (clipMargin * 2), viewportOffset.x)
                
                // Draw audio track clip with scrolling
                drawAudioClipScrolled(ctx, clipScreenX, topPadding + videoTrackHeight + clipMargin, clipWidth, audioTrackHeight - (clipMargin * 2), viewportOffset.x)
                
                // Draw trim overlays
                drawTrimOverlaysScrolled(ctx, clipScreenX, topPadding, clipWidth, totalHeight, viewportOffset.x)
            }
        }
        
        // Always draw playhead (critical UI element) - use timeline duration for positioning
        drawPlayheadScrolledWithDuration(ctx, trackLabelWidth, topPadding + totalHeight, viewportOffset.x, timelineDuration)
    }
    
    // Virtualized video clip rendering with thumbnail caching
    const drawVideoClipVirtualized = (ctx: CanvasRenderingContext2D, viewport: TimelineViewport, x: number, y: number, width: number, height: number) => {
        const borderRadius = 4
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, borderRadius)
        ctx.clip()
        
        // Clip background
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)'
        ctx.fillRect(x, y, width, height)
        
        // Calculate thumbnail dimensions
        const videoAspectRatio = 16 / 9
        const availableHeight = height - 16
        const thumbnailHeight = availableHeight
        const thumbnailWidth = thumbnailHeight * videoAspectRatio
        
        // Calculate visible thumbnail range for performance
        const visibleBounds = viewport.getVisibleBounds(x, width)
        const firstVisibleThumbnailIndex = Math.floor(Math.max(0, (visibleBounds.x - x) / thumbnailWidth))
        const lastVisibleThumbnailIndex = Math.ceil(Math.min(width / thumbnailWidth, (visibleBounds.x + visibleBounds.width - x) / thumbnailWidth))
        
        // Only render visible thumbnails
        for (let i = firstVisibleThumbnailIndex; i <= lastVisibleThumbnailIndex; i++) {
            const frameIndex = Math.floor((i / Math.ceil(width / thumbnailWidth)) * capturedFrames.length)
            const frame = capturedFrames[frameIndex]
            
            if (frame?.imageBitmap) {
                const thumbnailX = x + (i * thumbnailWidth)
                const thumbnailY = y
                
                // Skip if completely outside visible area
                if (thumbnailX + thumbnailWidth < visibleBounds.x || thumbnailX > visibleBounds.x + visibleBounds.width) {
                    continue
                }
                
                // Use cached thumbnail for better performance
                const cachedThumbnail = getCachedThumbnail(frameIndex, frame, Math.floor(thumbnailWidth), Math.floor(thumbnailHeight))
                
                // Calculate clipping for partial thumbnails
                const clipLeft = Math.max(0, visibleBounds.x - thumbnailX)
                const clipRight = Math.min(thumbnailWidth, visibleBounds.x + visibleBounds.width - thumbnailX)
                const drawWidth = clipRight - clipLeft
                
                if (drawWidth > 0) {
                    const sourceClipLeft = (clipLeft / thumbnailWidth) * cachedThumbnail.width
                    const sourceClipWidth = (drawWidth / thumbnailWidth) * cachedThumbnail.width
                    
                    ctx.drawImage(
                        cachedThumbnail,
                        sourceClipLeft, 0, sourceClipWidth, cachedThumbnail.height,
                        thumbnailX + clipLeft, thumbnailY, drawWidth, thumbnailHeight
                    )
                }
            }
        }
        
        ctx.restore()
        
        // Clip border with rounded corners
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, borderRadius)
        ctx.stroke()
        
        // Clip label with rounded bottom corners
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, y + height - 16, width, 16, [0, 0, borderRadius, borderRadius])
        ctx.clip()
        ctx.fillStyle = 'rgba(0,0,0, 0.7)'
        ctx.fillRect(x, y + height - 16, width, 16)
        ctx.restore()
        
        ctx.fillStyle = 'rgba(99, 102, 241, 0.7)'
        ctx.font = '10px monospace'
        ctx.textAlign = 'left'
        ctx.fillText('Video Clip', x + 8, y + height - 4)
    }
    
    // Scrolled video clip rendering (screen space coordinates)
    const drawVideoClipScrolled = (ctx: CanvasRenderingContext2D, screenX: number, y: number, width: number, height: number, scrollX: number) => {
        const borderRadius = 4
        const visibleStartX = Math.max(64, screenX) // Don't draw over track labels
        const visibleEndX = Math.min(screenX + width, ctx.canvas.width / (window.devicePixelRatio || 1))
        const visibleWidth = Math.max(0, visibleEndX - visibleStartX)
        
        if (visibleWidth <= 0) return
        
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(visibleStartX, y, visibleWidth, height, borderRadius)
        ctx.clip()
        
        // Clip background
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)'
        ctx.fillRect(visibleStartX, y, visibleWidth, height)
        
        // Calculate thumbnail dimensions
        const videoAspectRatio = 16 / 9
        const availableHeight = height - 16
        const thumbnailHeight = availableHeight
        const thumbnailWidth = thumbnailHeight * videoAspectRatio
        
        // Calculate which thumbnails are visible
        const thumbnailsPerClip = Math.ceil(width / thumbnailWidth)
        const firstVisibleIndex = Math.floor(Math.max(0, (visibleStartX - screenX) / thumbnailWidth))
        const lastVisibleIndex = Math.ceil(Math.min(thumbnailsPerClip, (visibleEndX - screenX) / thumbnailWidth))
        
        // Draw visible thumbnails
        for (let i = firstVisibleIndex; i <= lastVisibleIndex; i++) {
            const frameIndex = Math.floor((i / thumbnailsPerClip) * capturedFrames.length)
            const frame = capturedFrames[frameIndex]
            
            if (frame?.imageBitmap) {
                const thumbnailScreenX = screenX + (i * thumbnailWidth)
                
                if (thumbnailScreenX + thumbnailWidth > visibleStartX && thumbnailScreenX < visibleEndX) {
                    const cachedThumbnail = getCachedThumbnail(frameIndex, frame, Math.floor(thumbnailWidth), Math.floor(thumbnailHeight))
                    
                    const drawStartX = Math.max(thumbnailScreenX, visibleStartX)
                    const drawEndX = Math.min(thumbnailScreenX + thumbnailWidth, visibleEndX)
                    const drawWidth = drawEndX - drawStartX
                    
                    if (drawWidth > 0) {
                        const sourceStartX = (drawStartX - thumbnailScreenX) / thumbnailWidth * cachedThumbnail.width
                        const sourceWidth = drawWidth / thumbnailWidth * cachedThumbnail.width
                        
                        ctx.drawImage(
                            cachedThumbnail,
                            sourceStartX, 0, sourceWidth, cachedThumbnail.height,
                            drawStartX, y, drawWidth, thumbnailHeight
                        )
                    }
                }
            }
        }
        
        ctx.restore()
        
        // Clip border
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(visibleStartX, y, visibleWidth, height, borderRadius)
        ctx.stroke()
        
        // Clip label
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(visibleStartX, y + height - 16, visibleWidth, 16, [0, 0, borderRadius, borderRadius])
        ctx.clip()
        ctx.fillStyle = 'rgba(0,0,0, 0.7)'
        ctx.fillRect(visibleStartX, y + height - 16, visibleWidth, 16)
        ctx.restore()
        
        ctx.fillStyle = 'rgba(99, 102, 241, 0.7)'
        ctx.font = '10px monospace'
        ctx.textAlign = 'left'
        ctx.fillText('Video Clip', visibleStartX + 8, y + height - 4)
    }
    
    // Keep original function for backward compatibility if needed
    const drawVideoClip = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
        drawVideoClipScrolled(ctx, x, y, width, height, 0)
    }
    
    // Cached waveform generator with viewport optimization
    const getCachedWaveform = (audioBuffer: AudioBuffer | null, realtimeData: Float32Array[], width: number): number[] => {
        const cache = waveformCacheRef.current
        
        if (audioBuffer) {
            // Check if cached waveform is still valid
            if (cache.data && cache.audioLength === audioBuffer.length && cache.width === width) {
                return cache.data
            }
            
            // Generate new waveform data
            const waveformData = generateWaveformData(audioBuffer, width)
            cache.data = waveformData
            cache.audioLength = audioBuffer.length
            cache.width = width
            return waveformData
        } else if (realtimeData.length > 0) {
            // For real-time data, always regenerate (it's changing)
            return generateRealtimeWaveformData(realtimeData, width)
        }
        
        return []
    }
    
    // Virtualized audio clip rendering with waveform caching
    const drawAudioClipVirtualized = (ctx: CanvasRenderingContext2D, viewport: TimelineViewport, x: number, y: number, width: number, height: number) => {
        const borderRadius = 4
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, borderRadius)
        ctx.clip()
        
        // Clip background
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)'
        ctx.fillRect(x, y, width, height)
        
        // Get visible bounds for waveform optimization
        const visibleBounds = viewport.getVisibleBounds(x, width)
        const visibleWidth = Math.ceil(visibleBounds.width)
        const visibleX = visibleBounds.x - x
        
        // Draw waveform only for visible area
        if (capturedAudio.length > 0 && capturedAudio[0]) {
            // Use cached waveform data
            const fullWaveformData = getCachedWaveform(capturedAudio[0].audioBuffer, [], Math.floor(width))
            
            // Extract visible portion of waveform
            const startIndex = Math.floor((visibleX / width) * fullWaveformData.length)
            const endIndex = Math.ceil(((visibleX + visibleWidth) / width) * fullWaveformData.length)
            const visibleWaveformData = fullWaveformData.slice(startIndex, endIndex)
            
            if (visibleWaveformData.length > 0) {
                drawWaveformInCanvasVirtualized(ctx, visibleBounds.x, y, visibleWidth, height - 16, visibleWaveformData)
            }
        } else if (isRecording && realtimeAudioData.length > 0) {
            // For real-time data, generate visible portion only
            const visibleWaveformData = generateRealtimeWaveformData(realtimeAudioData, visibleWidth)
            if (visibleWaveformData.length > 0) {
                drawWaveformInCanvasVirtualized(ctx, visibleBounds.x, y, visibleWidth, height - 16, visibleWaveformData)
            }
        } else if (isRecording) {
            // Recording indicator - only show if visible
            if (viewport.isVisible(x + width / 4, width / 2)) {
                ctx.fillStyle = 'rgba(99, 102, 241, 0.6)'
                ctx.font = '12px monospace'
                ctx.textAlign = 'center'
                ctx.fillText('🎤 Recording...', x + width / 2, y + height / 2)
            }
        }
        
        ctx.restore()
        
        // Clip border with rounded corners
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(x, y, width, height, borderRadius)
        ctx.stroke()
        
        // Clip label with rounded bottom corners
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(x, y + height - 16, width, 16, [0, 0, borderRadius, borderRadius])
        ctx.clip()
        ctx.fillStyle = 'rgba(0,0,0, 0.7)'
        ctx.fillRect(x, y + height - 16, width, 16)
        ctx.restore()
        
        ctx.fillStyle = 'rgba(99, 102, 241, 0.7)'
        ctx.font = '10px monospace'
        ctx.textAlign = 'left'
        ctx.fillText('Audio Clip', x + 8, y + height - 4)
    }
    
    // Virtualized waveform drawing
    const drawWaveformInCanvasVirtualized = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, waveformData: number[]) => {
        if (waveformData.length === 0) return
        
        const bottomY = y + height
        const maxAmplitude = height
        
        // Create gradient fill
        const gradient = ctx.createLinearGradient(x, y, x, bottomY)
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.7)')
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.1)')
        
        // Draw filled waveform area
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x, bottomY)
        
        const pixelsPerSample = width / waveformData.length
        for (let i = 0; i < waveformData.length; i++) {
            const amplitude = waveformData[i] * maxAmplitude * 2
            const clampedAmplitude = Math.min(amplitude, maxAmplitude)
            ctx.lineTo(x + (i * pixelsPerSample), bottomY - clampedAmplitude)
        }
        
        ctx.lineTo(x + width, bottomY)
        ctx.closePath()
        ctx.fill()
        
        // Draw waveform outline
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, bottomY)
        for (let i = 0; i < waveformData.length; i++) {
            const amplitude = waveformData[i] * maxAmplitude * 2
            const clampedAmplitude = Math.min(amplitude, maxAmplitude)
            ctx.lineTo(x + (i * pixelsPerSample), bottomY - clampedAmplitude)
        }
        ctx.stroke()
    }
    
    // Scrolled audio clip rendering (screen space coordinates)
    const drawAudioClipScrolled = (ctx: CanvasRenderingContext2D, screenX: number, y: number, width: number, height: number, scrollX: number) => {
        const borderRadius = 4
        const visibleStartX = Math.max(64, screenX) // Don't draw over track labels
        const visibleEndX = Math.min(screenX + width, ctx.canvas.width / (window.devicePixelRatio || 1))
        const visibleWidth = Math.max(0, visibleEndX - visibleStartX)
        
        if (visibleWidth <= 0) return
        
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(visibleStartX, y, visibleWidth, height, borderRadius)
        ctx.clip()
        
        // Clip background
        ctx.fillStyle = 'rgba(99, 102, 241, 0.1)'
        ctx.fillRect(visibleStartX, y, visibleWidth, height)
        
        // Draw waveform for visible area
        if (capturedAudio.length > 0 && capturedAudio[0]) {
            const fullWaveformData = getCachedWaveform(capturedAudio[0].audioBuffer, [], Math.floor(width))
            
            // Calculate visible portion of waveform
            const startRatio = Math.max(0, (visibleStartX - screenX) / width)
            const endRatio = Math.min(1, (visibleEndX - screenX) / width)
            const startIndex = Math.floor(startRatio * fullWaveformData.length)
            const endIndex = Math.ceil(endRatio * fullWaveformData.length)
            const visibleWaveformData = fullWaveformData.slice(startIndex, endIndex)
            
            if (visibleWaveformData.length > 0) {
                drawWaveformInCanvasScrolled(ctx, visibleStartX, y, visibleWidth, height - 16, visibleWaveformData)
            }
        } else if (isRecording && realtimeAudioData.length > 0) {
            const visibleWaveformData = generateRealtimeWaveformData(realtimeAudioData, Math.floor(visibleWidth))
            if (visibleWaveformData.length > 0) {
                drawWaveformInCanvasScrolled(ctx, visibleStartX, y, visibleWidth, height - 16, visibleWaveformData)
            }
        } else if (isRecording) {
            // Recording indicator
            ctx.fillStyle = 'rgba(99, 102, 241, 0.6)'
            ctx.font = '12px monospace'
            ctx.textAlign = 'center'
            ctx.fillText('🎤 Recording...', visibleStartX + visibleWidth / 2, y + height / 2)
        }
        
        ctx.restore()
        
        // Clip border
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.3)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.roundRect(visibleStartX, y, visibleWidth, height, borderRadius)
        ctx.stroke()
        
        // Clip label
        ctx.save()
        ctx.beginPath()
        ctx.roundRect(visibleStartX, y + height - 16, visibleWidth, 16, [0, 0, borderRadius, borderRadius])
        ctx.clip()
        ctx.fillStyle = 'rgba(0,0,0, 0.7)'
        ctx.fillRect(visibleStartX, y + height - 16, visibleWidth, 16)
        ctx.restore()
        
        ctx.fillStyle = 'rgba(99, 102, 241, 0.7)'
        ctx.font = '10px monospace'
        ctx.textAlign = 'left'
        ctx.fillText('Audio Clip', visibleStartX + 8, y + height - 4)
    }
    
    // Waveform drawing for scrolled context
    const drawWaveformInCanvasScrolled = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, waveformData: number[]) => {
        if (waveformData.length === 0) return
        
        const bottomY = y + height
        const maxAmplitude = height
        
        // Create gradient fill
        const gradient = ctx.createLinearGradient(x, y, x, bottomY)
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.7)')
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.1)')
        
        // Draw filled waveform area
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x, bottomY)
        
        const pixelsPerSample = width / waveformData.length
        for (let i = 0; i < waveformData.length; i++) {
            const amplitude = waveformData[i] * maxAmplitude * 2
            const clampedAmplitude = Math.min(amplitude, maxAmplitude)
            ctx.lineTo(x + (i * pixelsPerSample), bottomY - clampedAmplitude)
        }
        
        ctx.lineTo(x + width, bottomY)
        ctx.closePath()
        ctx.fill()
        
        // Draw waveform outline
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, bottomY)
        for (let i = 0; i < waveformData.length; i++) {
            const amplitude = waveformData[i] * maxAmplitude * 2
            const clampedAmplitude = Math.min(amplitude, maxAmplitude)
            ctx.lineTo(x + (i * pixelsPerSample), bottomY - clampedAmplitude)
        }
        ctx.stroke()
    }
    
    // Keep original function for backward compatibility if needed
    const drawAudioClip = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
        drawAudioClipScrolled(ctx, x, y, width, height, 0)
    }
    
    const drawWaveformInCanvas = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, waveformData: number[]) => {
        if (waveformData.length === 0) return
        
        const bottomY = y + height
        const maxAmplitude = height
        
        // Create gradient fill
        const gradient = ctx.createLinearGradient(x, y, x, bottomY)
        gradient.addColorStop(0, 'rgba(99, 102, 241, 0.7)')
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.1)')
        
        // Draw filled waveform area
        ctx.fillStyle = gradient
        ctx.beginPath()
        ctx.moveTo(x, bottomY)
        
        for (let i = 0; i < waveformData.length; i++) {
            const amplitude = waveformData[i] * maxAmplitude * 2
            const clampedAmplitude = Math.min(amplitude, maxAmplitude)
            ctx.lineTo(x + i, bottomY - clampedAmplitude)
        }
        
        ctx.lineTo(x + waveformData.length, bottomY)
        ctx.closePath()
        ctx.fill()
        
        // Draw waveform outline
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(x, bottomY)
        for (let i = 0; i < waveformData.length; i++) {
            const amplitude = waveformData[i] * maxAmplitude * 2
            const clampedAmplitude = Math.min(amplitude, maxAmplitude)
            ctx.lineTo(x + i, bottomY - clampedAmplitude)
        }
        ctx.stroke()
    }
    
    // Scrolled trim overlays
    const drawTrimOverlaysScrolled = (ctx: CanvasRenderingContext2D, screenX: number, y: number, width: number, height: number, scrollX: number) => {
        const visibleStartX = Math.max(64, screenX)
        const visibleEndX = Math.min(screenX + width, ctx.canvas.width / (window.devicePixelRatio || 1))
        
        if (clipTrimStart > 0) {
            const trimWidth = (clipTrimStart / Math.max(1, capturedFrames.length - 1)) * width
            const trimEndX = screenX + trimWidth
            
            if (trimEndX > visibleStartX) {
                const overlayStartX = Math.max(visibleStartX, screenX)
                const overlayEndX = Math.min(visibleEndX, trimEndX)
                const overlayWidth = Math.max(0, overlayEndX - overlayStartX)
                
                if (overlayWidth > 0) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
                    ctx.fillRect(overlayStartX, y, overlayWidth, height)
                }
            }
        }
        
        if (clipTrimEnd < capturedFrames.length - 1) {
            const trimStartX = screenX + ((clipTrimEnd + 1) / Math.max(1, capturedFrames.length - 1)) * width
            
            if (trimStartX < visibleEndX) {
                const overlayStartX = Math.max(visibleStartX, trimStartX)
                const overlayEndX = Math.min(visibleEndX, screenX + width)
                const overlayWidth = Math.max(0, overlayEndX - overlayStartX)
                
                if (overlayWidth > 0) {
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
                    ctx.fillRect(overlayStartX, y, overlayWidth, height)
                }
            }
        }
    }
    
    const drawTrimOverlays = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) => {
        drawTrimOverlaysScrolled(ctx, x, y, width, height, 0)
    }
    
    // Scrolled playhead with timeline duration support
    const drawPlayheadScrolledWithDuration = (ctx: CanvasRenderingContext2D, trackLabelWidth: number, totalHeight: number, scrollX: number, timelineDuration: number) => {
        const pixelsPerSecond = 100 * timelineZoom
        let playheadPosition = 0
        
        if (capturedFrames.length > 0) {
            // Use actual frame position if frames exist
            const currentTime = currentFrameIndex / 30 // Convert frame to seconds
            playheadPosition = currentTime * pixelsPerSecond
        } else {
            // Default to start of timeline if no frames
            playheadPosition = 0
        }
        
        const playheadWorldX = trackLabelWidth + playheadPosition
        const playheadScreenX = playheadWorldX - scrollX
        
        // Only draw if playhead is visible
        const canvasWidth = ctx.canvas.width / (window.devicePixelRatio || 1)
        if (playheadScreenX >= trackLabelWidth && playheadScreenX <= canvasWidth) {
            // Playhead line
            ctx.strokeStyle = 'rgba(99, 102, 241, 0.8)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.moveTo(playheadScreenX, 8)
            ctx.lineTo(playheadScreenX, totalHeight)
            ctx.stroke()
            
            // Playhead circular head
            ctx.fillStyle = 'rgba(99, 102, 241, 1)'
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
            ctx.lineWidth = 2
            ctx.beginPath()
            ctx.arc(playheadScreenX, 8, 6, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
        }
    }
    
    // Scrolled playhead
    const drawPlayheadScrolled = (ctx: CanvasRenderingContext2D, trackLabelWidth: number, totalHeight: number, scrollX: number) => {
        const minTimelineDuration = 30
        const actualDuration = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDuration
        const timelineDuration = Math.max(minTimelineDuration, actualDuration)
        drawPlayheadScrolledWithDuration(ctx, trackLabelWidth, totalHeight, scrollX, timelineDuration)
    }
    
    const drawPlayhead = (ctx: CanvasRenderingContext2D, offsetX: number, totalHeight: number) => {
        drawPlayheadScrolled(ctx, offsetX, totalHeight, 0)
    }
    
    // Update scrollbar visibility synchronously to prevent layout shift
    useLayoutEffect(() => {
        const canvas = timelineCanvasRef.current
        if (!canvas) {
            setNeedsScrollbar(false)
            return
        }
        
        const rect = canvas.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) {
            setNeedsScrollbar(false)
            return
        }
        
        const trackLabelWidth = 64
        const minTimelineDuration = 30
        const actualDuration = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDuration
        const timelineDuration = Math.max(minTimelineDuration, actualDuration)
        const timelineWidth = timelineDuration * 100 * timelineZoom
        const contentWidth = trackLabelWidth + timelineWidth
        const maxScrollX = Math.max(0, contentWidth - rect.width)
        
        setNeedsScrollbar(maxScrollX > 0)
    }, [capturedFrames.length, timelineZoom])

    // Update timeline rendering on state changes (direct rendering)
    useEffect(() => {
        renderTimelineCanvas()
    }, [capturedFrames, capturedAudio, realtimeAudioData, isRecording, currentFrameIndex, clipTrimStart, clipTrimEnd, timelineZoom, viewportOffset.x])
    
    // ResizeObserver for efficient canvas resizing
    useEffect(() => {
        const canvas = timelineCanvasRef.current
        if (!canvas || !window.ResizeObserver) return
        
        const resizeObserver = new ResizeObserver(() => {
            // Invalidate render cache completely when canvas resizes
            lastRenderParams.current = { 
                capturedFrames: -1, 
                currentFrameIndex: -1, 
                clipTrimStart: -1, 
                clipTrimEnd: -1, 
                timelineZoom: -1, 
                viewportX: -1,
                offsetX: -1,
                isRecording: false,
                realtimeAudioDataLength: -1,
                capturedAudioLength: -1
            }
            renderTimelineCanvas()
        })
        
        resizeObserver.observe(canvas)
        
        return () => {
            resizeObserver.disconnect()
        }
    }, [])

    // Handle global mouse events for canvas dragging
    useEffect(() => {
        const handleGlobalMouseMove = (e: MouseEvent) => {
            const canvas = timelineCanvasRef.current
            if (!canvas || (!isDraggingPlayhead && !isDraggingLeftTrim && !isDraggingRightTrim && !isDraggingTimeline)) return
            
            const rect = canvas.getBoundingClientRect()
            const canvasX = e.clientX - rect.left
            const canvasY = e.clientY - rect.top
            // Transform screen coordinates to world coordinates
            const worldX = canvasX + viewportOffset.x
            
            const trackLabelWidth = 64
            const timelineX = trackLabelWidth
            const minTimelineDurationGlobal = 30
            const actualDurationGlobal = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDurationGlobal
            const timelineDurationGlobal = Math.max(minTimelineDurationGlobal, actualDurationGlobal)
            const timelineWidthGlobal = timelineDurationGlobal * 100 * timelineZoom
            
            if (isDraggingPlayhead) {
                const progress = Math.max(0, Math.min(1, (worldX - timelineX) / timelineWidthGlobal))
                const timePosition = progress * timelineDurationGlobal // seconds
                const frameIndex = Math.floor(timePosition * 30) // convert to frames, allow any position
                onScrubTimeline(frameIndex)
            } else if (isDraggingLeftTrim && capturedFrames.length > 0) {
                const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom
                const clipX = trackLabelWidth
                const progress = Math.max(0, Math.min(1, (worldX - clipX) / clipWidth))
                const frameIndex = Math.floor(progress * (capturedFrames.length - 1))
                const newLeftTrim = Math.max(0, Math.min(clipTrimEnd - 1, frameIndex))
                setClipTrimStart(newLeftTrim)
            } else if (isDraggingRightTrim && capturedFrames.length > 0) {
                const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom
                const clipX = trackLabelWidth
                const progress = Math.max(0, Math.min(1, (worldX - clipX) / clipWidth))
                const frameIndex = Math.floor(progress * (capturedFrames.length - 1))
                const newRightTrim = Math.max(clipTrimStart + 1, Math.min(capturedFrames.length - 1, frameIndex))
                setClipTrimEnd(newRightTrim)
            } else if (isDraggingTimeline) {
                // Handle timeline panning
                const deltaX = canvasX - dragStartRef.current.x
                const maxScrollX = Math.max(0, trackLabelWidth + timelineWidthGlobal - rect.width)
                const newOffsetX = Math.max(0, Math.min(maxScrollX, dragStartRef.current.offsetX - deltaX))
                setViewportOffset(prev => ({ ...prev, x: newOffsetX }))
            }
        }

        const handleGlobalMouseUp = () => {
            setIsDraggingPlayhead(false)
            setIsDraggingLeftTrim(false)
            setIsDraggingRightTrim(false)
            setIsDraggingTimeline(false)
        }

        if (isDraggingPlayhead || isDraggingLeftTrim || isDraggingRightTrim || isDraggingTimeline) {
            document.addEventListener('mousemove', handleGlobalMouseMove)
            document.addEventListener('mouseup', handleGlobalMouseUp)
        }

        return () => {
            document.removeEventListener('mousemove', handleGlobalMouseMove)
            document.removeEventListener('mouseup', handleGlobalMouseUp)
        }
    }, [isDraggingPlayhead, isDraggingLeftTrim, isDraggingRightTrim, capturedFrames.length, timelineZoom, clipTrimStart, clipTrimEnd, onScrubTimeline])
    
    // Handle canvas mouse events
    const handleTimelineMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = timelineCanvasRef.current
        if (!canvas) return
        
        const rect = canvas.getBoundingClientRect()
        const canvasX = e.clientX - rect.left
        const canvasY = e.clientY - rect.top
        // Transform screen coordinates to world coordinates
        const worldX = canvasX + viewportOffset.x
        const worldY = canvasY
        
        const trackLabelWidth = 64
        const videoTrackHeight = 80
        const topPadding = 20
        const timelineX = trackLabelWidth
        const minTimelineDurationDown = 30
        const actualDurationDown = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDurationDown
        const timelineDurationDown = Math.max(minTimelineDurationDown, actualDurationDown)
        const timelineWidthDown = timelineDurationDown * 100 * timelineZoom
        
        // Check if clicking on playhead (with expanded tolerance)
        const currentTime = capturedFrames.length > 0 ? currentFrameIndex / 30 : 0
        const playheadWorldX = timelineX + (currentTime * 100 * timelineZoom)
        if (Math.abs(worldX - playheadWorldX) < 8 && worldY >= topPadding) {
            setIsDraggingPlayhead(true)
            return
        }
        
        // Check if clicking on trim handles (only in track areas and if clips exist)
        if (capturedFrames.length > 0) {
            const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom
            const clipX = trackLabelWidth
            if (worldX >= clipX && worldX <= clipX + clipWidth && worldY >= topPadding) {
                const leftTrimX = clipX + (clipTrimStart / Math.max(1, capturedFrames.length - 1)) * clipWidth
                const rightTrimX = clipX + ((clipTrimEnd + 1) / Math.max(1, capturedFrames.length - 1)) * clipWidth
                
                if (Math.abs(worldX - leftTrimX) < 8) {
                    setIsDraggingLeftTrim(true)
                    return
                }
                
                if (Math.abs(worldX - rightTrimX) < 8) {
                    setIsDraggingRightTrim(true)
                    return
                }
            }
        }
        
        // Check for middle mouse button or shift+click for panning
        if (e.button === 1 || e.shiftKey) {
            setIsDraggingTimeline(true)
            dragStartRef.current = { 
                x: canvasX, 
                y: canvasY, 
                offsetX: viewportOffset.x 
            }
            return
        }
        
        // Allow scrubbing by clicking anywhere in the timeline area (including timecode ruler)
        if (worldX >= timelineX && worldX <= timelineX + timelineWidthDown) {
            const progress = Math.max(0, Math.min(1, (worldX - timelineX) / timelineWidthDown))
            const timePosition = progress * timelineDurationDown // seconds
            const frameIndex = Math.floor(timePosition * 30) // convert to frames, allow any position
            onScrubTimeline(frameIndex)
            // Start dragging playhead after scrubbing
            setIsDraggingPlayhead(true)
        } else {
            // Start timeline panning if clicking in empty space
            setIsDraggingTimeline(true)
            dragStartRef.current = { 
                x: canvasX, 
                y: canvasY, 
                offsetX: viewportOffset.x 
            }
        }
    }
    
    const handleTimelineMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = timelineCanvasRef.current
        if (!canvas) return
        
        const rect = canvas.getBoundingClientRect()
        const canvasX = e.clientX - rect.left
        const worldX = canvasX + viewportOffset.x
        
        const trackLabelWidth = 64
        const timelineX = trackLabelWidth
        const minTimelineDurationMove = 30
        const actualDurationMove = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDurationMove
        const timelineDurationMove = Math.max(minTimelineDurationMove, actualDurationMove)
        const timelineWidthMove = timelineDurationMove * 100 * timelineZoom
        
        if (isDraggingPlayhead) {
            const progress = Math.max(0, Math.min(1, (worldX - timelineX) / timelineWidthMove))
            const timePosition = progress * timelineDurationMove
            const frameIndex = Math.floor(timePosition * 30) // allow any position
            onScrubTimeline(frameIndex)
        } else if (isDraggingLeftTrim && capturedFrames.length > 0) {
            const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom
            const clipX = trackLabelWidth
            const progress = Math.max(0, Math.min(1, (worldX - clipX) / clipWidth))
            const frameIndex = Math.floor(progress * (capturedFrames.length - 1))
            const newLeftTrim = Math.max(0, Math.min(clipTrimEnd - 1, frameIndex))
            setClipTrimStart(newLeftTrim)
        } else if (isDraggingRightTrim && capturedFrames.length > 0) {
            const clipWidth = (capturedFrames.length / 30) * 100 * timelineZoom
            const clipX = trackLabelWidth
            const progress = Math.max(0, Math.min(1, (worldX - clipX) / clipWidth))
            const frameIndex = Math.floor(progress * (capturedFrames.length - 1))
            const newRightTrim = Math.max(clipTrimStart + 1, Math.min(capturedFrames.length - 1, frameIndex))
            setClipTrimEnd(newRightTrim)
        }
    }
    
    const handleTimelineMouseUp = () => {
        setIsDraggingPlayhead(false)
        setIsDraggingLeftTrim(false)
        setIsDraggingRightTrim(false)
        setIsDraggingTimeline(false)
    }
    
    // Handle mouse wheel for horizontal scrolling
    const handleTimelineWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault()
        
        const canvas = timelineCanvasRef.current
        if (!canvas) return
        
        const rect = canvas.getBoundingClientRect()
        const trackLabelWidth = 64
        const minTimelineDurationWheel = 30
        const actualDurationWheel = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDurationWheel
        const timelineDurationWheel = Math.max(minTimelineDurationWheel, actualDurationWheel)
        const timelineWidthWheel = timelineDurationWheel * 100 * timelineZoom
        const contentWidth = trackLabelWidth + timelineWidthWheel
        const maxScrollX = Math.max(0, contentWidth - rect.width)
        
        // Horizontal scrolling (shift+wheel or trackpad horizontal)
        let deltaX = e.deltaX
        
        // Convert vertical wheel to horizontal if no horizontal delta
        if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) {
            deltaX = e.deltaY
        }
        
        const scrollSpeed = 1.5
        const newOffsetX = Math.max(0, Math.min(maxScrollX, viewportOffset.x + (deltaX * scrollSpeed)))
        
        setViewportOffset(prev => ({ ...prev, x: newOffsetX }))
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
                {audioDevices.length > 0 && (
                    <label className="flex items-center gap-2 text-sm">
                        <span>Audio Device:</span>
                        <select
                            value={selectedAudioDevice}
                            onChange={e => setSelectedAudioDevice(e.target.value)}
                            className="px-2 py-1 text-sm border border-primary/20 rounded bg-primary/5 text-primary/80"
                        >
                            {audioDevices.map(device => (
                                <option key={device.deviceId} value={device.deviceId}>
                                    {device.label || `Microphone ${device.deviceId.slice(-4)}`}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
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

            {/* Canvas-Based Video Editor Timeline */}
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
                                step={0.01}
                                value={timelineZoom}
                                onChange={e => {
                                    const newZoom = Number(e.target.value)
                                    
                                    // Calculate playhead position before zoom
                                    const pixelsPerSecond = 100 * timelineZoom
                                    const trackLabelWidth = 64
                                    const currentTime = capturedFrames.length > 0 ? currentFrameIndex / 30 : 0
                                    const oldPlayheadWorldX = trackLabelWidth + (currentTime * pixelsPerSecond)
                                    
                                    // Calculate new playhead position after zoom
                                    const newPixelsPerSecond = 100 * newZoom
                                    const newPlayheadWorldX = trackLabelWidth + (currentTime * newPixelsPerSecond)
                                    
                                    // Calculate how much to adjust scroll to keep playhead centered
                                    const canvas = timelineCanvasRef.current
                                    if (canvas) {
                                        const rect = canvas.getBoundingClientRect()
                                        const playheadScreenPos = oldPlayheadWorldX - viewportOffset.x
                                        
                                        // Calculate new scroll offset to keep playhead at same screen position
                                        const newScrollX = newPlayheadWorldX - playheadScreenPos
                                        
                                        // Apply zoom first
                                        setTimelineZoom(newZoom)
                                        
                                        // Then adjust scroll position with bounds checking
                                        const minTimelineDurationForZoom = 30
                                        const actualDurationForZoom = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDurationForZoom
                                        const timelineDurationForZoom = Math.max(minTimelineDurationForZoom, actualDurationForZoom)
                                        const newTimelineWidth = timelineDurationForZoom * newPixelsPerSecond
                                        const maxScrollX = Math.max(0, trackLabelWidth + newTimelineWidth - rect.width)
                                        
                                        setViewportOffset(prev => ({ 
                                            ...prev, 
                                            x: Math.max(0, Math.min(maxScrollX, newScrollX))
                                        }))
                                    } else {
                                        setTimelineZoom(newZoom)
                                    }
                                }}
                                className="w-16 h-1"
                            />
                            <span className="text-xs text-primary/50 w-8">{timelineZoom.toFixed(1)}x</span>
                        </div>
                    </div>
                </div>

                {/* Canvas Timeline */}
                <canvas
                    ref={timelineCanvasRef}
                    className="w-full cursor-pointer"
                    height="180"
                    onMouseDown={handleTimelineMouseDown}
                    onMouseMove={handleTimelineMouseMove}
                    onMouseUp={handleTimelineMouseUp}
                    onWheel={handleTimelineWheel}
                    style={{ display: 'block', height: '180px' }}
                />
                
                {/* Horizontal Scrollbar - Always present to prevent layout shift */}
                {(() => {
                    const scrollbarHeight = 8
                    
                    if (needsScrollbar) {
                        const canvas = timelineCanvasRef.current
                        if (!canvas) {
                            return <div className="w-full bg-black/20 rounded" style={{ height: scrollbarHeight }} />
                        }
                        
                        const rect = canvas.getBoundingClientRect()
                        if (rect.width === 0 || rect.height === 0) {
                            return <div className="w-full bg-black/20 rounded" style={{ height: scrollbarHeight }} />
                        }
                        
                        const trackLabelWidth = 64
                        const minTimelineDurationScrollbar = 30
                        const actualDurationScrollbar = capturedFrames.length > 0 ? capturedFrames.length / 30 : minTimelineDurationScrollbar
                        const timelineDurationScrollbar = Math.max(minTimelineDurationScrollbar, actualDurationScrollbar)
                        const timelineWidthScrollbar = timelineDurationScrollbar * 100 * timelineZoom
                        const contentWidth = trackLabelWidth + timelineWidthScrollbar
                        const maxScrollX = Math.max(0, contentWidth - rect.width)
                        
                        const scrollbarWidth = rect.width
                        const thumbWidth = Math.max(20, (rect.width / contentWidth) * scrollbarWidth)
                        const thumbPosition = (viewportOffset.x / maxScrollX) * (scrollbarWidth - thumbWidth)
                        
                        return (
                            <div 
                                className="relative w-full bg-black/20 rounded"
                                style={{ height: scrollbarHeight }}
                            >
                                <div
                                    className="absolute top-0 bg-primary/40 rounded cursor-pointer hover:bg-primary/60 transition-colors"
                                    style={{
                                        left: thumbPosition,
                                        width: thumbWidth,
                                        height: scrollbarHeight
                                    }}
                                    onMouseDown={(e) => {
                                        e.preventDefault()
                                        const startX = e.clientX
                                        const startThumbPos = thumbPosition
                                        
                                        const handleMouseMove = (e: MouseEvent) => {
                                            const deltaX = e.clientX - startX
                                            const newThumbPos = Math.max(0, Math.min(scrollbarWidth - thumbWidth, startThumbPos + deltaX))
                                            const scrollRatio = newThumbPos / (scrollbarWidth - thumbWidth)
                                            const newScrollX = scrollRatio * maxScrollX
                                            setViewportOffset(prev => ({ ...prev, x: newScrollX }))
                                        }
                                        
                                        const handleMouseUp = () => {
                                            document.removeEventListener('mousemove', handleMouseMove)
                                            document.removeEventListener('mouseup', handleMouseUp)
                                        }
                                        
                                        document.addEventListener('mousemove', handleMouseMove)
                                        document.addEventListener('mouseup', handleMouseUp)
                                    }}
                                />
                            </div>
                        )
                    } else {
                        // Show empty scrollbar background to maintain consistent height
                        return (
                            <div 
                                className="w-full bg-black/10 rounded"
                                style={{ height: scrollbarHeight }}
                            />
                        )
                    }
                })()}
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
