'use client'

import { useEffect, useRef } from 'react'

import { MOTIONS, type MotionName, type Pose } from './drawing-motion'

type DrawingProps = {
    src: string
    label: string
    width: number
    height: number
    motion: MotionName
    className?: string
}

/* locomotive reports 0 as the frame enters the bottom of the window and 1 as it
   leaves the top, so 0.5 is the frame centred in the window. The motion runs
   symmetrically around that moment: halfway done when the drawing is centred */
const MOTION_BAND = [0.3, 0.7]

const toMotionProgress = (scrollProgress: number) =>
    Math.min(1, Math.max(0, (scrollProgress - MOTION_BAND[0]) / (MOTION_BAND[1] - MOTION_BAND[0])))

/**
 * An isometric drawing that moves as it scrolls through the window. The SVG is
 * fetched after load rather than server-rendered, so its ~1MB of paths stay out of
 * the page HTML, and inlined so its pieces can be posed. The frame is a locomotive
 * scroll target (`data-scroll`), so it shares the smoothing and the reduced-motion
 * behaviour of every other reveal on the site.
 */
export function Drawing({ src, label, width, height, motion, className = '' }: DrawingProps) {
    const frame = useRef<HTMLDivElement>(null)

    useEffect(() => {
        const host = frame.current
        if (!host) return
        const controller = new AbortController()
        let pose: Pose | null = null
        let latest = 0

        addEventListener(
            'lsprog',
            event => {
                const { target, progress } = (event as CustomEvent<{ target: HTMLElement; progress: number }>).detail
                if (target !== host) return
                latest = toMotionProgress(progress)
                pose?.(latest)
            },
            { signal: controller.signal }
        )

        fetch(src, { signal: controller.signal })
            .then(response => response.text())
            .then(markup => {
                host.innerHTML = markup
                const svg = host.querySelector('svg')
                if (!svg) return
                svg.removeAttribute('role')
                svg.setAttribute('aria-hidden', 'true')
                svg.style.cssText = 'display:block;width:100%;height:100%;overflow:visible'
                pose = MOTIONS[motion](svg)
                pose(latest)
            })
            .catch(() => {})

        return () => controller.abort()
    }, [src, motion])

    return (
        // `data-scroll` + the progress event are locomotive's hooks
        <div
            ref={frame}
            role="img"
            aria-label={label}
            data-scroll=""
            data-scroll-event-progress="lsprog"
            className={className}
            style={{ aspectRatio: `${width} / ${height}` }}
        />
    )
}
