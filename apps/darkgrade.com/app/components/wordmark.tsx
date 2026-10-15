import { WORDMARK_PATHS, WORDMARK_VIEWBOX } from '@/app/components/wordmark-paths'

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
