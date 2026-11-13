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

/**
 * An isometric drawing rendered live from a 3D model. three.js and the model are fetched after
 * load and only once the frame nears the window, so neither is in the page's first download.
 */
export function SceneCanvas({ scene, label, width, height, className = '' }: SceneCanvasProps) {
    const canvas = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const target = canvas.current
        if (!target) return
        let stop: (() => void) | undefined
        let unmounted = false
        void import('@/app/components/scenes/run-scene').then(({ runScene }) => {
            if (!unmounted) stop = runScene(target, scene)
        })
        return () => {
            unmounted = true
            stop?.()
        }
    }, [scene])

    return (
        <div role="img" aria-label={label} className={className} style={{ aspectRatio: `${width} / ${height}` }}>
            <canvas ref={canvas} aria-hidden="true" className="block size-full" />
        </div>
    )
}
