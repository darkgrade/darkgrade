'use client'

import { makeBackdrop, type Shot } from '@/app/components/dust/backdrop'
import { runViewport } from '@/app/components/dust/viewport'
import { useEffect, useRef } from 'react'

/**
 * darkgrade.com's dust, drawn live behind this page: hundreds of lines of points that move as a
 * cloth does, lit in the same cream and gold. The home page pulls its focus as the view turns
 * about the camera; there is no camera here, so the shot is held still and the dust drifts on its
 * own time.
 */
const HELD_STILL: Shot = { azimuth: 0, ink: 1, onScreen: 0, onLens: 0, ring: 0 }

export function Dust() {
    const canvas = useRef<HTMLCanvasElement | null>(null)

    useEffect(() => {
        const element = canvas.current
        if (!element) return
        return runViewport(
            element,
            () => {
                const backdrop = makeBackdrop()
                return {
                    draw(frame, renderer) {
                        backdrop.update(frame, HELD_STILL)
                        renderer.render(backdrop.scene, backdrop.camera)
                    },
                    dispose: () => backdrop.dispose(),
                }
            },
            // Full-window dust is cheaper at 1.5, as it is on darkgrade.com.
            { maximumPixelRatio: 1.5 }
        )
    }, [])

    return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 h-full w-full" />
}
