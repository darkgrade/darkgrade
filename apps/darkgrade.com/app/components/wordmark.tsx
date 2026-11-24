import { ICON_PATHS, ICON_VIEWBOX } from '@/app/components/wordmark-paths'

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
