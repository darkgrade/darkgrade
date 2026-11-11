interface AmbientBackdropProps {
    frameUrl: string | null
}

/**
 * The live frame again, enlarged and heavily blurred behind the whole window, so the chrome takes
 * on the colours at the edges of the picture without covering any of it. Blurring a small copy is
 * cheap; nothing is blurred through the live view itself.
 */
export function AmbientBackdrop({ frameUrl }: AmbientBackdropProps): React.JSX.Element | null {
    if (!frameUrl) return null
    return (
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden>
            <img
                className="size-full scale-125 object-cover opacity-70 blur-[80px] saturate-150 transition-[filter] duration-500"
                src={frameUrl}
                alt=""
            />
        </div>
    )
}
