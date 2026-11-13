import type { Ref } from 'react'

/** How wide the errors are laid out, in CSS pixels, before they are fitted to the camera's monitor. */
export const MONITOR_WIDTH_PIXELS = 380

/**
 * The kind of thing a camera stops a shoot to say. Each is placed by its left and top as shares
 * of the monitor, and waits its turn to pop up.
 */
const ERRORS = [
    { title: 'Card error', detail: 'Cannot access memory card' },
    { title: 'Overheating', detail: 'Camera will shut down' },
    { title: 'Recording stopped', detail: 'Card write speed too slow' },
    { title: 'Battery exhausted', detail: 'Change the battery' },
    { title: 'Not available', detail: 'This function is disabled in this mode' },
    { title: 'USB connection failed', detail: 'Check the cable' },
    { title: 'Card full', detail: 'Cannot record' },
    { title: 'Clock not set', detail: 'Set date and time' },
    { title: 'Lens not recognised', detail: 'Reattach the lens' },
    { title: 'Update required', detail: 'Lens firmware does not match' },
]
/** Where each error pops up, by its left and top as shares of the monitor: one for each error, each over the ones before it. */
const PLACES = [
    { left: 4, top: 4 },
    { left: 30, top: 13 },
    { left: 11, top: 23 },
    { left: 36, top: 31 },
    { left: 2, top: 40 },
    { left: 24, top: 48 },
    { left: 37, top: 57 },
    { left: 7, top: 64 },
    { left: 29, top: 72 },
    { left: 16, top: 80 },
]
/** How long one error waits after the one before it, in seconds. */
const STAGGER_SECONDS = 0.5

function Warning() {
    return (
        <svg
            viewBox="0 0 24 24"
            aria-hidden="true"
            className="mt-[1px] size-[20px] shrink-0 text-rec"
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
            className="absolute top-0 left-0 origin-top-left overflow-hidden bg-[var(--monitor-bg)] opacity-0 shadow-[inset_0_0_0_1.5px_rgba(234,230,220,.3)] will-change-transform"
            style={{ width: MONITOR_WIDTH_PIXELS }}
        >
            {ERRORS.map((error, index) => (
                <div
                    key={error.title}
                    className="monitor-error absolute flex w-[61%] items-start gap-[9px] rounded-[5px] border border-ink/45 bg-[var(--monitor-card)] px-[11px] py-[8px] shadow-[0_6px_22px_rgba(0,0,0,.7)]"
                    style={{
                        left: `${PLACES[index].left}%`,
                        top: `${PLACES[index].top}%`,
                        animationDelay: `${(index * STAGGER_SECONDS).toFixed(2)}s`,
                    }}
                >
                    <Warning />
                    <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
                        <span className="font-mono text-[14px] leading-[1.15] tracking-[.03em] text-ink uppercase">
                            {error.title}
                        </span>
                        <span className="text-[12px] leading-[1.25] text-ink-66">{error.detail}</span>
                    </span>
                    <span className="self-center rounded-[3px] border border-ink/40 px-[7px] py-[1px] font-mono text-[10px] tracking-[.08em] text-ink-66 uppercase">
                        OK
                    </span>
                </div>
            ))}
        </div>
    )
}
