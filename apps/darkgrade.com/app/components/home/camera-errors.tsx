import type { Ref } from 'react'

/** How wide the errors are laid out, in CSS pixels, before they are fitted to the camera's monitor. */
export const MONITOR_WIDTH_PIXELS = 600

/**
 * The kind of thing a camera stops a shoot to say. Each is placed by its left and top as shares
 * of the monitor, and waits its turn to pop up.
 */
const ERRORS = [
    { title: 'Card error', detail: 'Cannot access memory card', left: 6, top: 8 },
    { title: 'Overheating', detail: 'Camera will shut down', left: 44, top: 4 },
    { title: 'Recording stopped', detail: 'Card write speed too slow', left: 20, top: 30 },
    { title: 'Battery exhausted', detail: 'Change the battery', left: 52, top: 40 },
    { title: 'Not available', detail: 'This function is disabled in this mode', left: 3, top: 54 },
    { title: 'USB connection failed', detail: 'Check the cable', left: 36, top: 62 },
    { title: 'Card full', detail: 'Cannot record', left: 60, top: 18 },
    { title: 'Clock not set', detail: 'Set date and time', left: 14, top: 74 },
]
/** How long one error waits after the one before it, in seconds. */
const STAGGER_SECONDS = 0.55

function Warning() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="size-[26px] shrink-0 text-rec"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M12 3.5L22 20.5H2L12 3.5z" />
            <path d="M12 10v5M12 17.6v.1" />
        </svg>
    )
}

/**
 * What the camera's monitor shows in the menus chapter: one error after another, each over the
 * last, until the screen is all errors, and round again. Laid out flat at a fixed size; the page
 * fits it to the glass of the monitor in the picture with a transform.
 */
export function CameraErrors({ frame }: { frame: Ref<HTMLDivElement> }) {
    return (
        <div
            ref={frame}
            aria-hidden="true"
            className="absolute top-0 left-0 origin-top-left overflow-hidden bg-[#070708] opacity-0 will-change-transform"
            style={{ width: MONITOR_WIDTH_PIXELS }}
        >
            {ERRORS.map((error, index) => (
                <div
                    key={error.title}
                    className="monitor-error absolute flex w-[46%] items-start gap-3 rounded-[6px] border border-ink/45 bg-[#151517] px-4 py-3 shadow-[0_8px_30px_rgba(0,0,0,.7)]"
                    style={{
                        left: `${error.left}%`,
                        top: `${error.top}%`,
                        animationDelay: `${(index * STAGGER_SECONDS).toFixed(2)}s`,
                    }}
                >
                    <Warning />
                    <span className="flex min-w-0 flex-col gap-[3px]">
                        <span className="font-mono text-[17px] leading-[1.15] tracking-[.08em] text-ink uppercase">
                            {error.title}
                        </span>
                        <span className="text-[15px] leading-[1.25] text-ink-66">{error.detail}</span>
                        <span className="mt-[6px] self-end rounded-[3px] border border-ink/40 px-3 py-[2px] font-mono text-[13px] tracking-[.14em] text-ink-66 uppercase">
                            OK
                        </span>
                    </span>
                </div>
            ))}
        </div>
    )
}
