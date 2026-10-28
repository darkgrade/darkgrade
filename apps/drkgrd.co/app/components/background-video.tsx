'use client'

import { useEffect, useRef } from 'react'
import { createMuxBackdrop } from '@/app/components/mux'

/** The Mux playback ID of darkgrade.com's backdrop. public/bg-poster.jpg is its still. */
const BACKGROUND_VIDEO_ID = '5jSc3eg7Fh9OgGyz00kRt6gthd1KEWgwxqjmvLlJkp9M'

/**
 * darkgrade.com's backdrop video under its flat black dim, held at 70%.
 * Reduced motion keeps the poster and never streams.
 */
export function BackgroundVideo() {
    const videoRef = useRef<HTMLVideoElement>(null)

    useEffect(() => {
        const video = videoRef.current
        if (!video || matchMedia('(prefers-reduced-motion: reduce)').matches) return
        return createMuxBackdrop(video, video, BACKGROUND_VIDEO_ID)
    }, [])

    return (
        <div aria-hidden="true" className="pointer-events-none fixed top-0 left-0 z-0 h-[100lvh] w-full">
            <div className="absolute inset-0 overflow-hidden bg-[url(/bg-poster.jpg)] bg-cover bg-center">
                <video
                    ref={videoRef}
                    className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-700"
                    muted
                    loop
                    playsInline
                    preload="auto"
                    disablePictureInPicture
                />
            </div>
            <div className="absolute inset-0 bg-black opacity-70" />
        </div>
    )
}
