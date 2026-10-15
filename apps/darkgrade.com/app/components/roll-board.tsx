'use client'

import { Fragment, useEffect, useState } from 'react'

const ROLL_INTERVAL_MILLISECONDS = 1300
const ROLL_MILLISECONDS = 350

export interface RollItem {
    key: string
    node: React.ReactNode
}

interface RollBoardProps {
    /** The small heading above the board. */
    label: string
    items: readonly RollItem[]
    /** What screen readers hear, once, instead of the rolling board. */
    spoken: string
    align?: 'left' | 'right'
    /** Which way the column slides: `up` brings the next item in from below, `down` from above. */
    direction?: 'up' | 'down'
    /** Height of one row, in em of the board's 14px text. */
    rowHeightEm?: number
    className?: string
}

/**
 * A rolling board: the items sit in a column behind a one-row window, and the
 * column slides up a row at a time, forever. The first item is repeated at the
 * bottom so the last roll lands on it, then the column snaps back to the top
 * unseen. Every item has its own row, so two can never overlap.
 *
 * The board is aria-hidden. With reduced motion there is no board, just the
 * items in a wrapped line.
 */
export function RollBoard({
    label,
    items,
    spoken,
    align = 'left',
    direction = 'up',
    rowHeightEm = 1.8,
    className = '',
}: RollBoardProps) {
    // Rolling up the column runs first to last with the first item repeated at the
    // bottom; rolling down it is the mirror image, starting on the last row.
    const isUp = direction === 'up'
    const startRow = isUp ? 0 : items.length
    const endRow = isUp ? items.length : 0
    const rows = isUp ? [...items, items[0]] : [items[0], ...[...items].reverse()]
    const [row, setRow] = useState(startRow)
    const [isSnapping, setIsSnapping] = useState(false)
    const [isStatic, setIsStatic] = useState(false)
    const isRight = align === 'right'

    useEffect(() => {
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
            setIsStatic(true)
            return
        }
        const rollTimer = window.setInterval(
            () => setRow(current => current + (isUp ? 1 : -1)),
            ROLL_INTERVAL_MILLISECONDS
        )
        return () => window.clearInterval(rollTimer)
    }, [isUp])

    // Once the roll onto the repeated first item has finished, jump back to the
    // real one with no transition, then turn transitions back on two frames later.
    const snapBackToTop = () => {
        if (row !== endRow) return
        setIsSnapping(true)
        setRow(startRow)
    }

    useEffect(() => {
        if (!isSnapping) return
        let frame = requestAnimationFrame(() => {
            frame = requestAnimationFrame(() => setIsSnapping(false))
        })
        return () => cancelAnimationFrame(frame)
    }, [isSnapping])

    return (
        <div
            className={`font-mono text-label tracking-meta text-ink-62 ${isRight ? 'text-right' : 'text-left'} ${className}`}
        >
            {label}
            <span className="sr-only">: {spoken}</span>
            {isStatic ? (
                <div
                    className={`mt-1 flex max-w-[44ch] flex-wrap items-center gap-y-1 text-gold ${isRight ? 'justify-end' : ''}`}
                    aria-hidden="true"
                >
                    {items.map((item, index) => (
                        <Fragment key={item.key}>
                            {index > 0 && (
                                // drawn, not typed: the mono face has no middle-dot glyph
                                <span className="mx-[.7em] inline-block size-[3px] rounded-full bg-current" />
                            )}
                            {item.node}
                        </Fragment>
                    ))}
                </div>
            ) : (
                <div aria-hidden="true" className="mt-1 overflow-hidden" style={{ height: `${rowHeightEm}em` }}>
                    <div
                        onTransitionEnd={snapBackToTop}
                        style={{
                            transform: `translateY(${-row * rowHeightEm}em)`,
                            transition: isSnapping
                                ? 'none'
                                : `transform ${ROLL_MILLISECONDS}ms cubic-bezier(0.65, 0, 0.2, 1)`,
                        }}
                    >
                        {rows.map((item, index) => (
                            <div
                                key={index}
                                className={`flex items-center whitespace-nowrap text-gold ${isRight ? 'justify-end' : ''}`}
                                style={{ height: `${rowHeightEm}em` }}
                            >
                                {item.node}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
