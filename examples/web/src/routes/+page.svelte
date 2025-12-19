<script lang="ts">
    import { Camera } from '@camera/index'
    import { VendorIDs } from '@ptp/definitions/vendor-ids'
    import { USBTransport } from '@transport/usb/usb-transport'
    import { BrowserLogger } from '../lib/browser-logger'
    import Button from '../lib/Button.svelte'
    import CameraControls from '../lib/CameraControls.svelte'
    import { store } from '../lib/store.svelte'
    import { downloadFile } from '../lib/utils'
    import { streamFrame, startStreaming, stopStreaming } from '../lib/streaming'
    import { cameraQueue } from '../lib/queue'

    const logger = new BrowserLogger()
    const transport = new USBTransport(logger)
    // Camera instance - will be recreated on connect
    let camera: Camera | null = null

    $effect(() => {
        if (!store.canvasRef || !camera) return

        const ctx = store.canvasRef.getContext('2d')
        if (!ctx) return
        if (store.streaming && store.connected) {
            streamFrame(camera, ctx)
        }

        // cleanup
        return () => {
            store.streaming = false
            if (store.animationFrame) {
                cancelAnimationFrame(store.animationFrame)
                store.animationFrame = null
            }
        }
    })

    const onConnect = async () => {
        // Prompt user to select device and connect transport
        await transport.connect()

        // Get vendor ID from connected device
        const vendorId = transport.device?.vendorId || VendorIDs.SONY

        // Create camera instance based on detected vendor
        camera = new Camera(vendorId, transport, logger)

        // Camera.connect() will skip transport.connect() since already connected
        // and just open the PTP session
        await camera.connect()
        store.connected = true
        startStreaming()
    }

    const onDisconnect = async () => {
        stopStreaming()
        if (camera) {
            await camera.disconnect()
        }
        camera = null
        store.connected = false
    }

    const onCaptureImage = async () => {
        if (!camera) return
        try {
            const result = await cameraQueue.push(async () => await camera!.captureImage())
            if (result?.data) {
                const filename = result.info?.filename || `capture_${Date.now()}.jpg`
                downloadFile(result.data, filename, 'image/jpeg')
            }
        } catch (error) {
            console.error('Capture failed:', error)
        }
    }

    const onStartRecording = async () => {
        if (!camera) return
        try {
            await cameraQueue.push(async () => await camera!.startRecording())
            store.recording = true
        } catch (error) {
            console.error('Recording not supported:', error)
        }
    }

    const onStopRecording = async () => {
        if (!camera) return
        try {
            await cameraQueue.push(async () => await camera!.stopRecording())
            store.recording = false
        } catch (error) {
            console.error('Recording stop failed:', error)
        }
    }

    const onCaptureLiveView = async () => {
        if (!camera) return
        try {
            const result = await cameraQueue.push(async () => await camera!.captureLiveView())
            if (result && result.length > 0) {
                const filename = `liveview_${Date.now()}.jpg`
                downloadFile(result, filename, 'image/jpeg')
            }
        } catch (error) {
            console.error('Live view capture failed:', error)
        }
    }
</script>

<div class="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
    <div class="flex flex-row items-center justify-center gap-4 flex-wrap">
        <Button onClick={store.connected ? onDisconnect : onConnect}>
            {store.connected ? 'Disconnect' : 'Connect Camera'}
        </Button>
    </div>

    <!-- Always show live view frame -->
    <div class="relative flex justify-center">
        <div class="relative border border-primary/10 rounded-md overflow-hidden bg-primary/5">
            {#if store.streaming}
                <canvas
                    bind:this={store.canvasRef}
                    class="max-w-[80vw] max-h-[60vh] block"
                    style="display: {store.streaming ? 'block' : 'none'};"
                ></canvas>
            {:else}
                <div
                    class="flex items-center justify-center max-w-[80vw] max-h-[60vh] w-[640px] h-[480px] text-center text-sm text-primary/30"
                >
                    <span>{store.connected ? `Connected` : 'Disconnected'}</span>
                </div>
            {/if}

            <div class="absolute top-2 left-2 flex flex-row gap-4">
                <!-- FPS meter in top left -->
                <div class="px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono">
                    <span style="color: {store.fps > 24 ? '#4ade8088' : store.fps > 15 ? '#facc1588' : '#f87171'};">
                        {store.fps || 0}
                    </span>
                    FPS
                </div>

                <!-- Resolution display -->
                <div class="px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono">
                    {store.resolution?.width || '--'} × {store.resolution?.height || '--'}
                </div>

            </div>

            <!-- Exposure settings in top right -->
            <div
                class="absolute top-2 right-2 px-2 py-1 bg-black/70 rounded text-primary/30 text-xs font-mono flex flex-row gap-4"
            >
                <!-- Camera Controls -->
                {#if store.connected}
                    <CameraControls {camera} />
                {/if}
                <span
                    class="transition-colors duration-300"
                    style="color: {store.changedProps.has('exposure') ? '#4ade80' : undefined};"
                >
                    <!-- {store.settings?.exposure || '--'} -->
                </span>
            </div>

            <!-- Play/Pause button in bottom left -->
            <div class="absolute bottom-2 left-2">
                <Button
                    onClick={store.streaming ? stopStreaming : startStreaming}
                    disabled={!store.connected}
                    className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                >
                    {#if store.streaming}
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
                    disabled={!store.connected}
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
                    disabled={!store.connected}
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
                    onClick={store.recording ? onStopRecording : onStartRecording}
                    className="w-8! h-8! bg-black/50! hover:bg-black/70! rounded-md flex items-center justify-center text-primary/30 transition-all"
                >
                    {#if store.recording}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            fill="var(--color-red-400)"
                            viewBox="0 0 256 256"
                        >
                            <path
                                d="M216,56V200a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V56A16,16,0,0,1,56,40H200A16,16,0,0,1,216,56Z"
                            ></path>
                        </svg>
                    {:else}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="24"
                            height="24"
                            fill="currentColor"
                            viewBox="0 0 256 256"
                        >
                            <path
                                d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm72-88a72,72,0,1,1-72-72A72.08,72.08,0,0,1,200,128Z"
                            ></path>
                        </svg>
                    {/if}
                </Button>
            </div>
        </div>
    </div>
    <div>
        Notes:
        <ul class="list-disc list-outside ms-8 leading-relaxed">
            <li>Supports <strong>Sony</strong> and <strong>Nikon</strong> cameras (auto-detected)</li>
            <li>Ensure your camera is on the latest firmware</li>
            <li>WebUSB only works in Chromium-based browsers</li>
            <li>You may need to set permissions for "USB Devices" to "Ask" in Chrome site settings</li>
            <li><strong>Sony:</strong> USB mode must be set to "PC Remote mode"</li>
            <li><strong>Sony:</strong> Network > Network Option > Access Authen. Settings must be set to "Off"</li>
            <li><strong>Nikon:</strong> Ensure camera is in PC connection mode for live view</li>
            <li>
                MacOS tries to instantly claim the USB interface as soon as you connect the camera (<a
                    class="underline"
                    href="http://www.gphoto.org/doc/manual/FAQ.html#FAQ-already-in-use"
                    target="_blank">more info</a
                >).
                <br />You need to run this in Terminal for now until we can create a proper Electron build:<br />
                <pre class="mt-2"><code class="text-sm bg-foreground/20 rounded px-4 py-2"
                        >{`while ; do; kill -9 $(ps aux | grep "[p]tpcamera" | awk '{print $2}'); done`}</code
                    ></pre>
            </li>
        </ul>
    </div>
</div>
