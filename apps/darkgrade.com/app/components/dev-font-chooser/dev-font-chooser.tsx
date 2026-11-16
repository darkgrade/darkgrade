'use client'

import {
    applyDevFonts,
    CATEGORY_DEFINITIONS,
    FONT_CATEGORIES,
    FONTS_BY_CATEGORY,
    HEADING_WEIGHT_VARIABLE,
    HEADING_WEIGHTS,
    LOOPBACK_HOSTNAMES,
    STORAGE_KEY,
    STYLE_ELEMENT_ID,
    WEIGHTS_BY_CATEGORY,
    type FontCategory,
    type SelectedFonts,
} from '@/app/components/dev-font-chooser/dev-fonts'
import { useCallback, useEffect, useRef, useState } from 'react'

interface ChooserState {
    open: boolean
    category: FontCategory
    selected: SelectedFonts
    /** The weight headings are tried at, or null for the site's own. */
    headingWeight: number | null
    favorites: Record<FontCategory, string[]>
    /** When on (and the category has favorites), the arrow keys cycle only through them. */
    shortlistOnly: Record<FontCategory, boolean>
}

const COPIED_MESSAGE_MILLISECONDS = 1600

/* The panel must not be set in the fonts it is previewing. */
const PANEL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, monospace'

const KEY_HINTS: ReadonlyArray<[string, string]> = [
    ['← →', 'cycle'],
    ['↑ ↓ 1 2 3', 'category'],
    ['W', 'heading weight'],
    ['F', 'favorite'],
    ['S', 'shortlist'],
    ['R', 'reset'],
    ['C', 'copy'],
    ['`', 'hide'],
]

function createEmptyState(): ChooserState {
    return {
        open: true,
        category: 'heading',
        selected: { heading: null, body: null, mono: null },
        headingWeight: null,
        favorites: { heading: [], body: [], mono: [] },
        shortlistOnly: { heading: false, body: false, mono: false },
    }
}

function readStoredState(): ChooserState {
    const state = createEmptyState()
    // The panel is 330px wide: on a phone or a short window it would cover the page, so start tucked away.
    state.open = window.matchMedia('(min-width: 900px) and (min-height: 600px)').matches
    try {
        const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
        if (!stored) return state
        if (typeof stored.open === 'boolean') state.open = stored.open
        if (FONT_CATEGORIES.includes(stored.category)) state.category = stored.category
        if (HEADING_WEIGHTS.includes(stored.headingWeight)) state.headingWeight = stored.headingWeight
        for (const category of FONT_CATEGORIES) {
            state.selected[category] = stored.selected?.[category] ?? null
            state.favorites[category] = Array.isArray(stored.favorites?.[category]) ? stored.favorites[category] : []
            state.shortlistOnly[category] = stored.shortlistOnly?.[category] === true
        }
    } catch {
        // A corrupt entry just means starting fresh.
    }
    return state
}

function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function getCyclePool(state: ChooserState): string[] {
    const files = FONTS_BY_CATEGORY[state.category].map(font => font.family)
    if (!state.shortlistOnly[state.category]) return files
    const shortlist = files.filter(file => state.favorites[state.category].includes(file))
    return shortlist.length > 0 ? shortlist : files
}

function toggleFavoriteFile(state: ChooserState, file: string | null): ChooserState {
    if (file === null) return state
    const favorites = state.favorites[state.category]
    const updated = favorites.includes(file) ? favorites.filter(existing => existing !== file) : [...favorites, file]
    return { ...state, favorites: { ...state.favorites, [state.category]: updated } }
}

function toggleShortlistOnly(state: ChooserState): ChooserState {
    const enabled = !state.shortlistOnly[state.category]
    return { ...state, shortlistOnly: { ...state.shortlistOnly, [state.category]: enabled } }
}

/** The next heading weight up, coming round to the lightest after the heaviest. */
function stepHeadingWeight(state: ChooserState): ChooserState {
    const current = state.headingWeight === null ? -1 : HEADING_WEIGHTS.indexOf(state.headingWeight)
    return { ...state, headingWeight: HEADING_WEIGHTS[(current + 1) % HEADING_WEIGHTS.length] }
}

function stepThroughPool(pool: string[], current: string | null, direction: 1 | -1): string | null {
    if (pool.length === 0) return current
    const currentIndex = current === null ? -1 : pool.indexOf(current)
    if (currentIndex === -1) return direction === 1 ? pool[0] : pool[pool.length - 1]
    return pool[(currentIndex + direction + pool.length) % pool.length]
}

/**
 * Dev-only font picker. Lists a set of Google Fonts families (see dev-fonts.ts)
 * and lets you audition them live as the heading, body and mono fonts, keep a
 * shortlist of favorites per category, and copy the result once you have
 * decided. A family is fetched from Google Fonts only when it is chosen.
 * Renders nothing unless the page is served from localhost.
 */
export function DevFontChooser() {
    const [isLoopback, setIsLoopback] = useState(false)
    const [hasLoadedStorage, setHasLoadedStorage] = useState(false)
    const [state, setState] = useState<ChooserState>(createEmptyState)
    const [copied, setCopied] = useState(false)
    const activeRowRef = useRef<HTMLDivElement | null>(null)

    useEffect(() => {
        if (!LOOPBACK_HOSTNAMES.includes(location.hostname)) return
        setIsLoopback(true)
        setState(readStoredState())
        setHasLoadedStorage(true)
    }, [])

    useEffect(() => {
        if (hasLoadedStorage) localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    }, [hasLoadedStorage, state])

    useEffect(() => {
        if (!hasLoadedStorage) return
        applyDevFonts(
            state.selected,
            state.headingWeight,
            CATEGORY_DEFINITIONS,
            WEIGHTS_BY_CATEGORY,
            HEADING_WEIGHT_VARIABLE,
            STYLE_ELEMENT_ID
        )

        // Layout (scroll height, marquee width) was measured with the old font,
        // so once the new faces are in, ask whatever listens to re-measure.
        const loads = FONT_CATEGORIES.flatMap(category => {
            const file = state.selected[category]
            return file ? [document.fonts.load(`1em ${JSON.stringify(file)}`)] : []
        })
        void Promise.all(loads)
            .catch(() => undefined)
            .then(() => window.dispatchEvent(new Event('resize')))
    }, [hasLoadedStorage, state.selected, state.headingWeight])

    useEffect(() => {
        activeRowRef.current?.scrollIntoView({ block: 'nearest' })
    }, [state.category, state.selected, state.open])

    const copyLockIn = useCallback(() => {
        const lockIn = {
            ...Object.fromEntries(
                FONT_CATEGORIES.map(category => [
                    category,
                    { selected: state.selected[category], favorites: state.favorites[category] },
                ])
            ),
            headingWeight: state.headingWeight,
        }
        void navigator.clipboard
            .writeText(JSON.stringify(lockIn, null, 2))
            .then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), COPIED_MESSAGE_MILLISECONDS)
            })
            .catch(() => undefined) // clipboard can be denied; there is nothing useful to do
    }, [state.favorites, state.selected, state.headingWeight])

    useEffect(() => {
        if (!isLoopback) return

        const selectCategoryAtOffset = (offset: number) =>
            setState(previous => {
                const index = FONT_CATEGORIES.indexOf(previous.category)
                const next = (index + offset + FONT_CATEGORIES.length) % FONT_CATEGORIES.length
                return { ...previous, category: FONT_CATEGORIES[next] }
            })

        const cycleFont = (direction: 1 | -1) =>
            setState(previous => {
                const pool = getCyclePool(previous)
                const next = stepThroughPool(pool, previous.selected[previous.category], direction)
                return { ...previous, selected: { ...previous.selected, [previous.category]: next } }
            })

        const resetCategory = () =>
            setState(previous => ({ ...previous, selected: { ...previous.selected, [previous.category]: null } }))

        const toggleOpen = () => setState(previous => ({ ...previous, open: !previous.open }))

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return

            if (event.key === '`') {
                event.preventDefault()
                toggleOpen()
                return
            }
            if (!state.open) return

            // Arrows drive the chooser only while it is open, so closing it hands page scrolling back.
            const handlers: Record<string, () => void> = {
                ArrowRight: () => cycleFont(1),
                ArrowLeft: () => cycleFont(-1),
                ArrowDown: () => selectCategoryAtOffset(1),
                ArrowUp: () => selectCategoryAtOffset(-1),
                '1': () => setState(previous => ({ ...previous, category: 'heading' })),
                '2': () => setState(previous => ({ ...previous, category: 'body' })),
                '3': () => setState(previous => ({ ...previous, category: 'mono' })),
                w: () => setState(stepHeadingWeight),
                f: () => setState(previous => toggleFavoriteFile(previous, previous.selected[previous.category])),
                s: () => setState(toggleShortlistOnly),
                r: resetCategory,
                c: copyLockIn,
                Escape: toggleOpen,
            }
            const handler = handlers[event.key.length === 1 ? event.key.toLowerCase() : event.key]
            if (!handler) return
            event.preventDefault()
            handler()
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isLoopback, state.open, copyLockIn])

    if (!isLoopback) return null

    const category = state.category
    const selectedFile = state.selected[category]
    const favorites = state.favorites[category]
    const fonts = FONTS_BY_CATEGORY[category]
    const pool = getCyclePool(state)
    const shortlistActive = state.shortlistOnly[category] && favorites.length > 0
    const positionLabel = selectedFile && pool.includes(selectedFile) ? pool.indexOf(selectedFile) + 1 : '–'

    if (!state.open) {
        return (
            <button
                type="button"
                title="Open the font chooser (`)"
                onClick={() => setState(previous => ({ ...previous, open: true }))}
                style={{ fontFamily: PANEL_FONT_FAMILY }}
                className="fixed bottom-[104px] left-4 z-[300] cursor-pointer rounded-full border border-hair bg-[rgba(10,10,11,.92)] px-3 py-[6px] text-[11px] text-ink-55 backdrop-blur-[10px] hover:border-gold hover:text-gold"
            >
                Aa
            </button>
        )
    }

    return (
        <aside
            style={{ fontFamily: PANEL_FONT_FAMILY }}
            className="fixed bottom-[104px] left-4 z-[300] w-[330px] rounded-[10px] border border-hair bg-[rgba(10,10,11,.94)] p-3 text-[11px] leading-[1.4] text-ink-55 shadow-[0_10px_40px_rgba(0,0,0,.6)] backdrop-blur-[14px] select-none"
        >
            <div className="mb-2 flex items-center justify-between text-[10px] tracking-[.18em] text-ink-52 uppercase">
                <span>Font chooser · dev</span>
                <button
                    type="button"
                    onClick={copyLockIn}
                    className="cursor-pointer tracking-[.18em] uppercase hover:text-gold"
                    title="Copy the selection and favorites as JSON (C)"
                >
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>

            <div className="mb-2 grid grid-cols-3 gap-1">
                {FONT_CATEGORIES.map(candidate => {
                    const isActive = candidate === category
                    const favoriteCount = state.favorites[candidate].length
                    return (
                        <button
                            key={candidate}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setState(previous => ({ ...previous, category: candidate }))}
                            className="cursor-pointer rounded-[6px] border border-hair px-2 py-[5px] text-left hover:border-gold aria-pressed:border-[rgba(244,198,110,.45)] aria-pressed:bg-gold-dim aria-pressed:text-gold"
                        >
                            <div>{CATEGORY_DEFINITIONS[candidate].label}</div>
                            <div className="text-[10px] opacity-60">★ {favoriteCount}</div>
                        </button>
                    )
                })}
            </div>

            <div className="mb-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-[13px] text-ink">{selectedFile ?? 'Site default'}</div>
                    <div className="text-[10px] text-ink-52">
                        {positionLabel} / {pool.length}
                        {shortlistActive ? ' · shortlist' : ''}
                        {category === 'heading' ? ` · weight ${state.headingWeight ?? 'site'}` : ''}
                    </div>
                </div>
                <div className="flex shrink-0 gap-1">
                    <button
                        type="button"
                        disabled={selectedFile === null}
                        onClick={() => setState(previous => toggleFavoriteFile(previous, selectedFile))}
                        title="Favorite (F)"
                        className="cursor-pointer rounded-[6px] border border-hair px-2 py-[3px] hover:border-gold disabled:cursor-default disabled:opacity-40"
                    >
                        {selectedFile && favorites.includes(selectedFile) ? '★' : '☆'}
                    </button>
                    <button
                        type="button"
                        aria-pressed={state.shortlistOnly[category]}
                        onClick={() => setState(toggleShortlistOnly)}
                        title="Cycle only through favorites (S)"
                        className="cursor-pointer rounded-[6px] border border-hair px-2 py-[3px] hover:border-gold aria-pressed:border-[rgba(244,198,110,.45)] aria-pressed:bg-gold-dim aria-pressed:text-gold"
                    >
                        Shortlist
                    </button>
                </div>
            </div>

            <div data-lenis-prevent className="mb-2 max-h-[168px] overflow-y-auto rounded-[6px] border border-hair">
                {fonts.map(font => {
                    const isSelected = font.family === selectedFile
                    return (
                        <div
                            key={font.family}
                            ref={isSelected ? activeRowRef : undefined}
                            className={`flex items-center justify-between gap-2 px-2 py-[3px] ${isSelected ? 'bg-gold-dim text-gold' : 'hover:bg-[rgba(234,230,220,.05)]'}`}
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    setState(previous => ({
                                        ...previous,
                                        selected: { ...previous.selected, [previous.category]: font.family },
                                    }))
                                }
                                className="min-w-0 flex-1 cursor-pointer truncate text-left"
                            >
                                {font.family}
                                {category === 'heading' && font.heaviest && (
                                    <span className="ml-2 opacity-50">{font.heaviest}</span>
                                )}
                            </button>
                            <button
                                type="button"
                                aria-label={`Toggle favorite for ${font.family}`}
                                onClick={() => setState(previous => toggleFavoriteFile(previous, font.family))}
                                className="cursor-pointer opacity-70 hover:opacity-100"
                            >
                                {favorites.includes(font.family) ? '★' : '☆'}
                            </button>
                        </div>
                    )
                })}
            </div>

            <div className="flex flex-wrap gap-x-3 gap-y-[2px] text-[10px] text-ink-52">
                {KEY_HINTS.map(([keys, action]) => (
                    <span key={action}>
                        <b className="font-normal text-ink-55">{keys}</b> {action}
                    </span>
                ))}
            </div>
        </aside>
    )
}
