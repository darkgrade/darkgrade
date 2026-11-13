import type { Ref } from 'react'

/** How wide what runs on the laptop is laid out, in CSS pixels, before it is fitted to the screen. */
export const SCREEN_WIDTH_PIXELS = 1280

interface LaptopScreenProps {
    frame: Ref<HTMLDivElement>
    /** The two things that run on it, one over the other; the page shows whichever the picture is on. */
    link: { layer: Ref<HTMLDivElement>; children: React.ReactNode }
    cut: { layer: Ref<HTMLDivElement>; children: React.ReactNode }
}

const LAYER = 'absolute inset-0 opacity-0'

/**
 * The laptop's screen as a flat box: the whole inner face of its lid, rounded as the lid is, with
 * a black bezel round a window. The page fits it to the lid in the picture with a transform
 * (`transformOnto`), so it tilts and grows with the laptop.
 */
export function LaptopScreen({ frame, link, cut }: LaptopScreenProps) {
    return (
        <div
            ref={frame}
            aria-hidden="true"
            className="absolute top-0 left-0 origin-top-left rounded-[40px] bg-black p-[15px] pb-[22px] opacity-0 will-change-transform"
            style={{ width: SCREEN_WIDTH_PIXELS }}
        >
            <div className="relative h-full overflow-hidden rounded-[27px] bg-[#0b0b0c]">
                <div ref={link.layer} className={LAYER}>
                    {link.children}
                </div>
                <div ref={cut.layer} className={LAYER}>
                    {cut.children}
                </div>
            </div>
        </div>
    )
}

/**
 * The CSS transform that lays a flat box `width` by `height` pixels over four points: its top
 * left, top right, bottom right and bottom left, as x, y pairs. The box must have its transform
 * origin at its top left.
 */
export function transformOnto(width: number, height: number, corners: number[]): string {
    const [x0, y0, x1, y1, x2, y2, x3, y3] = corners
    const [acrossX, acrossY, downX, downY] = [x1 - x2, y1 - y2, x3 - x2, y3 - y2]
    const [leftoverX, leftoverY] = [x0 - x1 + x2 - x3, y0 - y1 + y2 - y3]
    const scale = acrossX * downY - downX * acrossY
    // How much the box narrows across and down: both nothing when the four points are a parallelogram.
    const narrowsAcross = (leftoverX * downY - downX * leftoverY) / scale
    const narrowsDown = (acrossX * leftoverY - leftoverX * acrossY) / scale
    const column = (a: number, b: number, c: number, size: number) => `${a / size},${b / size},0,${c / size}`
    return `matrix3d(${column(x1 - x0 + narrowsAcross * x1, y1 - y0 + narrowsAcross * y1, narrowsAcross, width)},${column(x3 - x0 + narrowsDown * x3, y3 - y0 + narrowsDown * y3, narrowsDown, height)},0,0,1,0,${x0},${y0},0,1)`
}
