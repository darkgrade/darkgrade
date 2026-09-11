'use client'

import { useSyncExternalStore } from 'react'
import { getBgMode, getBgModeServer, setBgMode, subscribeBgMode } from './background-mode'

/**
 * Switches the backdrop between the silk shader and the topographic contours.
 * Both keep running on one clock, so the swap cross-fades in place rather than
 * restarting either animation.
 */
export function BackgroundToggle() {
    const mode = useSyncExternalStore(subscribeBgMode, getBgMode, getBgModeServer)
    const on = mode === 'contours'

    return (
        <div className="flex items-center gap-[10px] max-[900px]:hidden">
            {/* JetBrains Mono, so both labels are exactly as wide as each other */}
            <span className="font-mono text-[9.5px] tracking-[.22em] text-ink-35 uppercase select-none">
                {on ? 'Topo' : 'Silk'}
            </span>
            <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-label="Use the topographic background"
                title={on ? 'Switch to the silk background' : 'Switch to the topographic background'}
                onClick={() => setBgMode(on ? 'silk' : 'contours')}
                className="group/bg relative h-[22px] w-[40px] shrink-0 cursor-pointer rounded-full border border-hair transition-[border-color,background,box-shadow] duration-[350ms] hover:border-gold aria-checked:border-[rgba(244,198,110,.45)] aria-checked:bg-gold-dim"
            >
                <span className="absolute top-1/2 left-[3px] size-[12px] -translate-y-1/2 rounded-full bg-ink-55 transition-[transform,background,box-shadow] duration-[350ms] ease-lamp group-hover/bg:bg-ink group-aria-checked/bg:translate-x-[18px] group-aria-checked/bg:bg-gold group-aria-checked/bg:shadow-[0_0_calc(8px*var(--gI))_rgba(244,198,110,.6)]" />
            </button>
        </div>
    )
}
