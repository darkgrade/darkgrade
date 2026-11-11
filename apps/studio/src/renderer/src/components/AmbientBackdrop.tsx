import { useLiveFrame } from '@renderer/lib/live-frame-store'
import { useEffect, useRef } from 'react'

interface AmbientBackdropProps {
    active: boolean
}

/** The backdrop only carries the picture's colours, so a few updates a second and a few dozen pixels are plenty. */
const UPDATE_INTERVAL_MS = 250
const TINY_WIDTH = 16
const CANVAS_WIDTH = 64

/**
 * The live frame's colours behind the whole window, so the chrome takes on the picture's mood
 * without covering it. The frame is shrunk to 16 pixels and blurred inside a 64-pixel canvas a
 * few times a second; the browser only scales that tiny canvas up, so no full-window blur runs.
 */
export function AmbientBackdrop({ active }: AmbientBackdropProps): React.JSX.Element | null {
    const frame = useLiveFrame()
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const lastUpdateRef = useRef(0)
    const decodingRef = useRef(false)

    useEffect(() => {
        const canvas = canvasRef.current
        if (!active || !frame || !canvas || decodingRef.current) return
        const now = performance.now()
        if (now - lastUpdateRef.current < UPDATE_INTERVAL_MS) return
        lastUpdateRef.current = now
        decodingRef.current = true
        void createImageBitmap(frame.blob, { resizeWidth: TINY_WIDTH, resizeQuality: 'medium' })
            .then(bitmap => {
                const height = Math.max(1, Math.round((CANVAS_WIDTH * bitmap.height) / bitmap.width))
                if (canvas.width !== CANVAS_WIDTH || canvas.height !== height) {
                    canvas.width = CANVAS_WIDTH
                    canvas.height = height
                }
                const context = canvas.getContext('2d')
                if (context) {
                    context.filter = 'blur(5px) saturate(1.5)'
                    context.drawImage(bitmap, -8, -8, CANVAS_WIDTH + 16, height + 16)
                }
                bitmap.close()
            })
            .catch(() => {})
            .finally(() => {
                decodingRef.current = false
            })
    }, [active, frame])

    if (!active) return null
    return (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
            <canvas ref={canvasRef} className="size-full scale-125 object-cover opacity-70" />
        </div>
    )
}
