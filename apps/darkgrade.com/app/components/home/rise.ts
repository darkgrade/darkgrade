'use client'

import { type RefObject, useEffect } from 'react'

/**
 * Marks every `[data-rise]` element inside `root` as risen once it enters the window, which
 * home.css turns into a fade up. Elements rise once and stay.
 */
export function useRise(root: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const host = root.current
        if (!host) return
        const observer = new IntersectionObserver(
            entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue
                    entry.target.classList.add('is-risen')
                    observer.unobserve(entry.target)
                }
            },
            { rootMargin: '0px 0px -12% 0px' }
        )
        host.querySelectorAll('[data-rise]').forEach(element => observer.observe(element))
        return () => observer.disconnect()
    }, [root])
}
