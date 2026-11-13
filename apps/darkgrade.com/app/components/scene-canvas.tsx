'use client'

import { useEffect, useRef } from 'react'

import type { SceneName } from '@/app/components/scenes/run-scene'

type SceneCanvasProps = {
    scene: SceneName
    label: string
    width: number
    height: number
    className?: string
}

/** Must match CANVAS_OVER_FRAME in scenes/run-scene.ts, which is not imported here so three.js stays out of the first load. */
const CANVAS_OVER_FRAME = 1.8
const CANVAS_INSET = `${(-(CANVAS_OVER_FRAME - 1) / 2) * 100}%`
/** The canvas dissolves over its outer tenth on every side, so whatever reaches its edge fades instead of ending in a line. */
const SOFT_EDGES =
    'linear-gradient(to right, transparent, #000 10%, #000 90%, transparent), linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent)'

/**
 * An isometric drawing rendered live from a 3D model, which a drag turns about. The drawing is
 * laid out in the frame but drawn on a canvas that spills well past it, so it is never cut off
 * at the frame's edge. three.js and the model are fetched after load and only once the frame
 * nears the window, so neither is in the page's first download.
 */
export function SceneCanvas({ scene, label, width, height, className = '' }: SceneCanvasProps) {
    const frame = useRef<HTMLDivElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const [target, host] = [canvas.current, frame.current]
        if (!target || !host) return
        let stop: (() => void) | undefined
        let unmounted = false
        void import('@/app/components/scenes/run-scene').then(({ runScene }) => {
            if (!unmounted) stop = runScene(target, host, scene)
        })
        return () => {
            unmounted = true
            stop?.()
        }
    }, [scene])

    return (
        // touch-pan-y: a finger moving up or down still scrolls the page; moving sideways turns the drawing
        <div
            ref={frame}
            role="img"
            aria-label={label}
            className={`relative cursor-grab touch-pan-y select-none active:cursor-grabbing ${className}`}
            style={{ aspectRatio: `${width} / ${height}` }}
        >
            <canvas
                ref={canvas}
                aria-hidden="true"
                className="pointer-events-none absolute max-w-none"
                style={{
                    inset: CANVAS_INSET,
                    width: `${CANVAS_OVER_FRAME * 100}%`,
                    height: `${CANVAS_OVER_FRAME * 100}%`,
                    maskImage: SOFT_EDGES,
                    maskComposite: 'intersect',
                    WebkitMaskImage: SOFT_EDGES,
                    WebkitMaskComposite: 'source-in',
                }}
            />
        </div>
    )
}
