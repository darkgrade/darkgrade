import { ICON_PATHS, ICON_VIEWBOX, WORDMARK_PATHS, WORDMARK_VIEWBOX } from '@/app/components/wordmark-paths'

/**
 * The Darkgrade wordmark, defined once as an SVG <symbol> and referenced by
 * every instance on the page. `WordmarkSprite` has to be mounted once, near
 * the top of the document, for the <use> references to resolve.
 */
export function WordmarkSprite() {
    return (
        <svg width="0" height="0" className="absolute" aria-hidden="true">
            <symbol id="dgmark" viewBox={`0 0 ${WORDMARK_VIEWBOX.width} ${WORDMARK_VIEWBOX.height}`}>
                {WORDMARK_PATHS.map(pathData => (
                    <path key={pathData} d={pathData} fill="currentColor" />
                ))}
            </symbol>
        </svg>
    )
}

export function Wordmark({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 600 56" role="img" aria-label="Darkgrade" className={className}>
            <use href="#dgmark" />
        </svg>
    )
}

/**
 * The mark beside the name set in the heading face, one weight lighter than a heading, in place of
 * the drawn wordmark. It is sized by its font size: the mark stands a little taller than the capitals.
 */
export function Lockup({ className = '' }: { className?: string }) {
    return (
        <span
            role="img"
            aria-label="Darkgrade"
            className={`inline-flex items-center gap-[.4em] leading-none ${className}`}
        >
            <svg
                viewBox={`0 0 ${ICON_VIEWBOX.width} ${ICON_VIEWBOX.height}`}
                aria-hidden="true"
                className="h-[.82em] w-auto shrink-0"
                fill="currentColor"
            >
                {ICON_PATHS.map(pathData => (
                    <path key={pathData} d={pathData} />
                ))}
            </svg>
            <span aria-hidden="true" className="lockup-weight font-serif tracking-[-.035em] normal-case">
                Darkgrade
            </span>
        </span>
    )
}
