import { CHAPTERS, type CutPage, buildCutScene } from '@/app/components/home/cut-scene'
import { runViewport } from '@/app/components/home/viewport'

/** How big the picture is drawn, in CSS pixels: the shape of a link preview card, at half its size. */
export const PICTURE_SIZE = { width: 1200, height: 630 }

/**
 * Draws the home page's picture on a canvas, held at its first shot: the camera drawn apart, with
 * the dust behind it. It is the backdrop of the link preview cards. The canvas keeps its last
 * frame, so it can be copied whenever a card is drawn. Returns how to stop.
 */
export function runSitePicture(canvas: HTMLCanvasElement, onReady: () => void): () => void {
    // The picture reads which shot to hold from where its page's sections are in the window. This one stands in for all of them and never leaves the top, which is the first shot.
    const section = document.createElement('div')
    section.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:200vh;pointer-events:none;visibility:hidden'
    document.body.appendChild(section)

    const nothing = () => undefined
    const page: CutPage = {
        sections: CHAPTERS.map(() => section),
        placeCallout: nothing,
        setReading: nothing,
        logCall: nothing,
        answerCall: nothing,
        showState: nothing,
        showChapter: nothing,
        placeScreen: nothing,
        placeMonitor: nothing,
    }
    const stop = runViewport(canvas, () => buildCutScene(page), {
        maximumPixelRatio: 2,
        preserveDrawingBuffer: true,
        onReady,
    })
    return () => {
        stop()
        section.remove()
    }
}
