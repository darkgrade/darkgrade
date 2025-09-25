<script lang="ts">
    import { Camera } from '@api/camera'
    import Button from '../lib/Button.svelte'

    const downloadFile = (data: Uint8Array, filename: string, mimeType: string = 'application/octet-stream') => {
        const blob = new Blob([new Uint8Array(data)], { type: mimeType })
        const url = URL.createObjectURL(blob)
        const a = Object.assign(document.createElement('a'), { href: url, download: filename })
        a.click()
        URL.revokeObjectURL(url)
    }

    // Camera state
    let camera: Camera | null = null
    let connected = $state(false)
    let streaming = $state(false)
    let fps = $state(0)
    let resolution = $state<{
        source: { width: number; height: number }
    } | null>(null)
    let canvasRef = $state<HTMLCanvasElement>()
    let streamingRef = false
    let animationFrameRef: number | null = null
    let frameTimestamps: number[] = []
    let lastFpsUpdate = 0
    let settings = $state<{
        aperture: string
        shutterSpeed: string
        iso: string
        liveViewImageQuality: string
    } | null>(null)
    let changedProps = $state<Set<string>>(new Set())
    let previousSettings: typeof settings = null

    camera = new Camera()

    // High-performance streaming using Canvas and requestAnimationFrame
    $effect(() => {
        if (!canvasRef) return

        const ctx = canvasRef.getContext('2d')
        if (!ctx) return

        streamingRef = streaming

        const streamFrame = async () => {
            if (!streamingRef || !camera || !connected || !canvasRef) return

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
                if (previousSettings) {
                    const changed = new Set<string>()
                    if (previousSettings.aperture !== newSettings.aperture) changed.add('aperture')
                    if (previousSettings.shutterSpeed !== newSettings.shutterSpeed) changed.add('shutterSpeed')
                    if (previousSettings.iso !== newSettings.iso) changed.add('iso')
                    if (previousSettings.liveViewImageQuality !== newSettings.liveViewImageQuality)
                        changed.add('liveViewImageQuality')

                    if (changed.size > 0) {
                        changedProps = changed
                        // Clear highlights after animation
                        setTimeout(() => (changedProps = new Set()), 1000)
                    }
                }

                previousSettings = newSettings
                settings = newSettings

                const result = await camera.streamLiveView()
                if (result && streamingRef) {
                    // Decode JPEG binary data directly to ImageBitmap (no URLs!)
                    const blob = new Blob([new Uint8Array(result)], { type: 'image/jpeg' })
                    const imageBitmap = await createImageBitmap(blob)

                    // Set canvas dimensions to match image
                    canvasRef.width = imageBitmap.width
                    canvasRef.height = imageBitmap.height

                    // Update resolution state
                    resolution = {
                        source: { width: imageBitmap.width, height: imageBitmap.height },
                    }

                    // Draw ImageBitmap directly to canvas
                    ctx.drawImage(imageBitmap, 0, 0)

                    // Clean up ImageBitmap resources
                    imageBitmap.close()

                    // Calculate FPS
                    const now = performance.now()
                    frameTimestamps.push(now)

                    // Keep only last 30 frame timestamps for rolling average
                    if (frameTimestamps.length > 30) {
                        frameTimestamps.shift()
                    }

                    // Update FPS display every 500ms
                    if (now - lastFpsUpdate > 500) {
                        if (frameTimestamps.length >= 2) {
                            const timeSpan = frameTimestamps[frameTimestamps.length - 1] - frameTimestamps[0]
                            const currentFps = Math.round(((frameTimestamps.length - 1) * 1000) / timeSpan)
                            fps = currentFps
                        }
                        lastFpsUpdate = now
                    }

                    // Schedule next frame
                    if (streamingRef) {
                        animationFrameRef = requestAnimationFrame(streamFrame)
                    }
                }
            } catch (error) {
                console.error('Error capturing live view:', error)
                // Continue streaming even if one frame fails
                if (streamingRef) {
                    animationFrameRef = requestAnimationFrame(streamFrame)
                }
            }
        }

        if (streaming && connected) {
            streamFrame()
        }

        return () => {
            streamingRef = false
            if (animationFrameRef) {
                cancelAnimationFrame(animationFrameRef)
                animationFrameRef = null
            }
        }
    })

    const onConnect = async () => {
        await camera?.connect()
        connected = true
    }

    const onDisconnect = async () => {
        try {
            // Stop streaming and cleanup
            if (streaming) {
                stopStreaming()
            }
            await camera?.disconnect()
            connected = false
        } catch (error) {
            console.error('Failed to disconnect from camera:', error)
            connected = false
        }
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

    const startStreaming = () => {
        streaming = true
    }

    const stopStreaming = () => {
        streaming = false
        streamingRef = false
        if (animationFrameRef) {
            cancelAnimationFrame(animationFrameRef)
            animationFrameRef = null
        }
        // Reset FPS tracking and resolution
        fps = 0
        resolution = null
        frameTimestamps = []
        lastFpsUpdate = 0
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
</script>

<div class="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
    <div class="flex flex-row items-center justify-center gap-4 flex-wrap">
        <Button onClick={connected ? onDisconnect : onConnect}>
            {connected ? 'Disconnect' : 'Connect'}
        </Button>
    </div>

    <!-- Always show live view frame -->
    <div class="relative flex justify-center">
        <div class="relative border border-primary/10 rounded-md overflow-hidden bg-primary/5">
            {#if streaming}
                <canvas
                    bind:this={canvasRef}
                    class="max-w-[80vw] max-h-[60vh] block"
                    style="display: {streaming ? 'block' : 'none'};"
                ></canvas>
            {:else}
                <div
                    class="flex items-center justify-center max-w-[80vw] max-h-[60vh] w-[640px] h-[480px] text-center text-sm text-primary/30"
                >
                    <span>{connected ? `Connected` : 'Disconnected'}</span>
                </div>
            {/if}

            <div class="absolute top-2 left-2 flex flex-row gap-4">
                <!-- FPS meter in top left -->
                <div class="px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono">
                    <span style="color: {fps > 24 ? '#4ade8088' : fps > 15 ? '#facc1588' : '#f87171'};">
                        {fps || 0}
                    </span>
                    FPS
                </div>

                <!-- Resolution display -->
                <div class="px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono">
                    {resolution?.source.width || '--'} × {resolution?.source.height || '--'}
                </div>

                <!-- Live view image quality display -->
                <div
                    class="px-2 py-1 bg-black/70 rounded text-xs font-mono cursor-pointer select-none transition-colors duration-300"
                    style="color: {changedProps.has('liveViewImageQuality') ? '#4ade80' : '#ffffff4c'};"
                    onclick={onToggleLiveViewImageQuality}
                    onkeydown={e => e.key === 'Enter' && onToggleLiveViewImageQuality()}
                    role="button"
                    tabindex="0"
                >
                    {settings?.liveViewImageQuality ? (settings.liveViewImageQuality === 'HIGH' ? 'HQ' : 'LQ') : '--'}
                </div>
            </div>

            <!-- Exposure settings in top right -->
            <div
                class="absolute top-2 right-2 px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono flex flex-row gap-4"
            >
                <span
                    class="transition-colors duration-300"
                    style="color: {changedProps.has('aperture') ? '#4ade80' : undefined};"
                >
                    {settings?.aperture || '--'}
                </span>
                <span
                    class="transition-colors duration-300"
                    style="color: {changedProps.has('shutterSpeed') ? '#4ade80' : undefined};"
                >
                    {settings?.shutterSpeed || '--'}
                </span>
                <span
                    class="transition-colors duration-300"
                    style="color: {changedProps.has('iso') ? '#4ade80' : undefined};"
                >
                    {settings?.iso || '--'}
                </span>
            </div>

            <!-- Play/Pause button in bottom left -->
            <div class="absolute bottom-2 left-2">
                <Button
                    onClick={streaming ? stopStreaming : startStreaming}
                    disabled={!connected}
                    className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                >
                    {#if streaming}
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                        </svg>
                    {:else}
                        <svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    {/if}
                </Button>
            </div>

            <div class="absolute bottom-2 right-2 flex flex-row gap-2">
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
                        <path
                            d="M201.54,54.46A104,104,0,0,0,54.46,201.54,104,104,0,0,0,201.54,54.46ZM190.23,65.78a88.18,88.18,0,0,1,11,13.48L167.55,119,139.63,40.78A87.34,87.34,0,0,1,190.23,65.78ZM155.59,133l-18.16,21.37-27.59-5L100.41,123l18.16-21.37,27.59,5ZM65.77,65.78a87.34,87.34,0,0,1,56.66-25.59l17.51,49L58.3,74.32A88,88,0,0,1,65.77,65.78ZM46.65,161.54a88.41,88.41,0,0,1,2.53-72.62l51.21,9.35Zm19.12,28.68a88.18,88.18,0,0,1-11-13.48L88.45,137l27.92,78.18A87.34,87.34,0,0,1,65.77,190.22Zm124.46,0a87.34,87.34,0,0,1-56.66,25.59l-17.51-49,81.64,14.91A88,88,0,0,1,190.23,190.22Zm-34.62-32.49,53.74-63.27a88.41,88.41,0,0,1-2.53,72.62Z"
                        ></path>
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
                        <path
                            d="M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z"
                        ></path>
                    </svg>
                </Button>

                <Button
                    disabled={true}
                    className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="24"
                        height="24"
                        fill="var(--color-red-400)"
                        viewBox="0 0 256 256"
                    >
                        <path
                            d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm72-88a72,72,0,1,1-72-72A72.08,72.08,0,0,1,200,128Z"
                        ></path>
                    </svg>
                </Button>
            </div>
        </div>
    </div>
</div>
