import type { Callout } from '@/app/components/home/cut-scene'

/* The four readings pinned to the camera while Link drives it: what each is called, what it says before any call is made, and where its words stand. */

export const CALLOUT_NAMES: Record<Callout, string> = {
    aperture: 'Aperture',
    focus: 'Focus',
    shutter: 'Shutter',
    iso: 'ISO',
}
export const FIRST_READINGS: Record<Callout, string> = { aperture: 'f/2.8', focus: 'AF-S', shutter: '1/60', iso: '100' }

/** Which side of its leader a callout's words are set on. ISO's are on the left, away from the shutter's beside it. */
export const CALLOUT_SIDE: Record<Callout, 'left' | 'right'> = {
    aperture: 'right',
    focus: 'right',
    shutter: 'right',
    iso: 'left',
}

/** The shortest a callout's leader is, in pixels. The focus reading is out over the front of the lens with nothing above it, and keeps this. */
const SHORTEST_LEADER_PIXELS: Record<Callout, number> = { aperture: 50, focus: 26, shutter: 38, iso: 14 }
/** The callouts whose dots are on the body, under its highest part: their leaders run on up until their words are clear of the camera's top, by this many pixels each. They differ so that neighbours never share a line. */
const CLEAR_OF_THE_CAMERA_BY_PIXELS: Partial<Record<Callout, number>> = { aperture: 10, shutter: 26, iso: 10 }

/** How tall a callout's leader is, in pixels, given how far above its dot the top of the camera is on the screen. */
export function leaderPixels(callout: Callout, cameraTopAbovePixels: number): number {
    const clearBy = CLEAR_OF_THE_CAMERA_BY_PIXELS[callout]
    if (clearBy === undefined) return SHORTEST_LEADER_PIXELS[callout]
    return Math.max(SHORTEST_LEADER_PIXELS[callout], cameraTopAbovePixels + clearBy)
}
