import './polyfills'
import './globals.css'
import React from 'react'
import * as ReactDOM from 'react-dom/client'
import { Camera } from '@api/camera'
import { useEffect, useState } from 'react'
import { CameraInfo } from '@camera/interfaces/camera.interface'
import type { ButtonHTMLAttributes, DetailedHTMLProps } from 'react'

const downloadFile = (data: Uint8Array, filename: string, mimeType: string = 'application/octet-stream') => {
    const blob = new Blob([new Uint8Array(data)], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = Object.assign(document.createElement('a'), { href: url, download: filename })
    a.click()
    URL.revokeObjectURL(url)
}

const useCamera = () => {
    const [camera, setCamera] = useState<Camera | null>(null)

    useEffect(() => {
        const camera = new Camera()
        setCamera(camera)
    }, [])

    return camera
}

const Button = ({ children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => {
    return (
        <button
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm transition-all disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2 has-[>svg]:px-3 cursor-pointer disabled:cursor-not-allowed"
            {...props}
        >
            {children}
        </button>
    )
}

export default function App() {
    const camera = useCamera()
    const [connected, setConnected] = useState(false)
    const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null)
    const [streaming, setStreaming] = useState(false)
    const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null)

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
            onStopStreaming()
        }
        await camera?.disconnect()
        setConnected(false)
    }

    const onCaptureImage = async () => {
        const result = await camera?.captureImage()
        if (result?.data) {
            const filename = result.info?.filename || 'captured_image.jpg'
            downloadFile(result.data, filename, 'image/jpeg')
        }
    }

    const onCaptureLiveView = async () => {
        const result = await camera?.captureLiveView()
        if (result?.data) {
            const filename = result.info?.filename || 'captured_liveview.jpg'
            downloadFile(result.data, filename, 'image/jpeg')
        }
    }

    useEffect(() => {
        let streamingRef = streaming
        let timeoutId: NodeJS.Timeout | null = null

        const streamFrame = async () => {
            if (!streamingRef || !camera) return

            try {
                const result = await camera.captureLiveView()
                if (result?.data && streamingRef) {
                    // Clean up previous URL
                    if (liveViewUrl) {
                        URL.revokeObjectURL(liveViewUrl)
                    }

                    const blob = new Blob([new Uint8Array(result.data)], { type: 'image/jpeg' })
                    const url = URL.createObjectURL(blob)
                    setLiveViewUrl(url)
                }
            } catch (error) {
                console.error('Error capturing live view:', error)
            }

            // Schedule next frame if still streaming
            if (streamingRef) {
                timeoutId = setTimeout(streamFrame, 34)
            }
        }

        if (streaming && connected) {
            streamFrame()
        }

        return () => {
            streamingRef = false
            if (timeoutId) {
                clearTimeout(timeoutId)
            }
            if (liveViewUrl) {
                URL.revokeObjectURL(liveViewUrl)
            }
        }
    }, [streaming, connected, camera, liveViewUrl])

    const onStartStreaming = () => {
        setStreaming(true)
    }

    const onStopStreaming = () => {
        setStreaming(false)
        if (liveViewUrl) {
            URL.revokeObjectURL(liveViewUrl)
            setLiveViewUrl(null)
        }
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen gap-6 p-4">
            <div className="flex flex-row items-center justify-center gap-4 flex-wrap">
                <Button onClick={connected ? onDisconnect : onConnect}>{connected ? 'Disconnect' : 'Connect'}</Button>
                {connected && <Button onClick={onCaptureImage}>Capture Image</Button>}
                {connected && <Button onClick={onCaptureLiveView}>Capture Live View</Button>}
            </div>

            <div className="text-center text-sm text-gray-600">
                {connected ? `${cameraInfo?.manufacturer} Connected` : 'Disconnected'}
            </div>

            {/* Always show live view frame */}
            {connected && (
                <div className="relative flex justify-center">
                    <div className="relative border border-primary/10 rounded-md overflow-hidden bg-primary/5">
                        {liveViewUrl && streaming ? (
                            <img src={liveViewUrl} alt="Live View" className="max-w-[80vw] max-h-[60vh] block" />
                        ) : (
                            <div className="flex items-center justify-center max-w-[80vw] max-h-[60vh] w-[640px] h-[480px] text-primary">
                                <span>Live view</span>
                            </div>
                        )}

                        {/* Play/Pause button in bottom right */}
                        <button
                            onClick={streaming ? onStopStreaming : onStartStreaming}
                            className="absolute bottom-2 left-2 w-8 h-8 bg-black/50 hover:bg-black/70 rounded-md flex items-center justify-center text-white transition-all"
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
                        </button>
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
