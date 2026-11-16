'use client'

import { type RefObject, useEffect } from 'react'

import { watch } from '@/app/components/home/motion'

/**
 * When a sheet's words come and go, as shares of the window's height from its top: they come
 * once the top of their sheet has risen this far up the window, and go once its foot has. The
 * two are apart, so one sheet's words are gone before the next one's come.
 */
const WORDS = { comeWhenTopIsAbove: 0.5, goWhenFootIsAbove: 0.7 }

/**
 * Tells the words of every sheet inside `root` whether their sheet is still ahead, here, or
 * passed, by setting `data-words` on each element that has it. The words are held in the window
 * and home.css fades them up into place and up out of it, in their own time, whatever the pace
 * of the scroll.
 */
export function useHeldWords(root: RefObject<HTMLElement | null>) {
    useEffect(() => {
        const host = root.current
        if (!host) return
        const held = [...host.querySelectorAll<HTMLElement>('[data-words]')].flatMap(words => {
            const sheet = words.closest('section')
            return sheet ? [{ words, sheet }] : []
        })
        function tell() {
            for (const { words, sheet } of held) {
                const bounds = sheet.getBoundingClientRect()
                const state =
                    bounds.top > innerHeight * WORDS.comeWhenTopIsAbove
                        ? 'ahead'
                        : bounds.bottom < innerHeight * WORDS.goWhenFootIsAbove
                          ? 'passed'
                          : 'here'
                if (words.dataset.words !== state) words.dataset.words = state
            }
        }
        const stopWatching = watch(() => scrollY, tell)
        addEventListener('resize', tell)
        return () => {
            stopWatching()
            removeEventListener('resize', tell)
        }
    }, [root])
}
