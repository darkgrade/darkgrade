import { CALLOUT_NAMES, CALLOUT_SIDE, FIRST_READINGS, leaderPixels } from '@/app/components/home/callouts'
import {
    CALLOUTS,
    CHAPTERS,
    type Callout,
    type Chapter,
    type CutPage,
    type Shot,
    buildCutScene,
} from '@/app/components/home/cut-scene'
import { runViewport } from '@/app/components/home/viewport'

/** How big the picture is drawn, in CSS pixels: the shape of a link preview card, at half its size. */
export const PICTURE_SIZE = { width: 1200, height: 630 }

/** Which of the home page's shots a picture is held at, how many times further back than the page it is seen from, and what else of the shot it changes. */
export interface PictureFraming {
    chapter: Chapter
    standBack: number
    reframe?: Partial<Shot>
}

/** One of the readings pinned to the camera, as the home page labels it: where its dot is, as shares of the picture across and down, and how tall its leader is, as a share of the picture's height. */
export interface PictureLabel {
    name: string
    reading: string
    across: number
    down: number
    leader: number
    /** Which side of the leader its words are set on. */
    side: 'left' | 'right'
}

export interface SitePicture {
    /** The labels as they stand on the frame the canvas is holding. None while the camera is not being driven. */
    labels(): PictureLabel[]
    stop(): void
}

/** A stand-in for a section of the home page, fixed in the window with its top this many window-heights down. */
function standIn(windowsDown: number): HTMLElement {
    const section = document.createElement('div')
    section.style.cssText = `position:fixed;top:${windowsDown * 100}vh;left:0;width:1px;height:100vh;pointer-events:none;visibility:hidden`
    document.body.appendChild(section)
    return section
}

/**
 * Draws the home page's picture on a canvas, held at the shot of one chapter, and keeps track of
 * the labels the page would pin to it. It is the backdrop of the link preview cards. The canvas
 * keeps its last frame, so it can be copied whenever a card is drawn.
 */
export function runSitePicture(canvas: HTMLCanvasElement, framing: PictureFraming, onReady: () => void): SitePicture {
    // The picture reads which shot to hold from where its page's sections are in the window: it holds the shot of the section whose middle is at the window's. So the chapters before the one wanted stand in above the window, and the one wanted fills it.
    const [passed, held] = [standIn(-2), standIn(0)]
    const holding = CHAPTERS.indexOf(framing.chapter)
    const readings = { ...FIRST_READINGS }
    const pinned = new Map<Callout, { x: number; y: number; strength: number; cameraTopAbove: number }>()

    const nothing = () => undefined
    const page: CutPage = {
        sections: CHAPTERS.map((_, index) => (index < holding ? passed : held)),
        placeCallout: (callout, x, y, strength, cameraTopAbove) =>
            pinned.set(callout, { x, y, strength, cameraTopAbove }),
        setReading: (callout, text) => {
            readings[callout] = text
        },
        logCall: nothing,
        answerCall: nothing,
        showState: nothing,
        showChapter: nothing,
        placeScreen: nothing,
        placeMonitor: nothing,
        adjustShot: shot => {
            Object.assign(shot, framing.reframe)
            shot.distance *= framing.standBack
        },
    }
    const stop = runViewport(canvas, () => buildCutScene(page), {
        maximumPixelRatio: 2,
        preserveDrawingBuffer: true,
        onReady,
    })
    return {
        labels: () =>
            CALLOUTS.flatMap(callout => {
                const pin = pinned.get(callout)
                if (!pin || pin.strength < 0.5) return []
                return [
                    {
                        name: CALLOUT_NAMES[callout],
                        reading: readings[callout],
                        across: pin.x / PICTURE_SIZE.width,
                        down: pin.y / PICTURE_SIZE.height,
                        leader: leaderPixels(callout, pin.cameraTopAbove) / PICTURE_SIZE.height,
                        side: CALLOUT_SIDE[callout],
                    },
                ]
            }),
        stop() {
            stop()
            passed.remove()
            held.remove()
        },
    }
}
