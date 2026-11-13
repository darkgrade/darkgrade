interface Principle {
    index: string
    title: string
    body: string
}

interface PrincipleStepsProps {
    principles: readonly Principle[]
    /** Which one is open. */
    active: number
    /** Asks the page to make another the open one. */
    onChoose: (index: number) => void
}

/**
 * The principles as numbered steps, laid out as a manual lays out an operation: ruled rows of
 * titles, with only the active one lit and opened to its body.
 */
export function PrincipleSteps({ principles, active, onChoose }: PrincipleStepsProps) {
    return (
        <ol>
            {principles.map((principle, index) => {
                const isActive = index === active
                return (
                    <li key={principle.index} className="border-t border-hair last:border-b">
                        <button
                            type="button"
                            onClick={() => onChoose(index)}
                            aria-current={isActive ? 'step' : undefined}
                            className="flex w-full cursor-pointer items-baseline gap-5 py-[clamp(9px,1.7vh,17px)] text-left"
                        >
                            <span
                                className={`w-[34px] shrink-0 font-mono text-[12px] tracking-[.1em] transition-colors duration-300 ${isActive ? 'text-gold' : 'text-ink-52'}`}
                            >
                                {principle.index}
                            </span>
                            <span
                                className={`font-serif text-[clamp(1.375rem,min(2.4vw,3.8vh),2.25rem)] leading-none transition-colors duration-300 ${isActive ? 'text-ink' : 'text-ink/40'}`}
                            >
                                {principle.title}
                            </span>
                        </button>
                        <div
                            className={`grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(.19,1,.22,1)] ${isActive ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}
                        >
                            <div className="overflow-hidden">
                                <p className="max-w-[42ch] pb-[clamp(12px,2.2vh,22px)] pl-[54px] text-[15px] leading-[1.6] text-ink-66 max-[900px]:pl-0">
                                    {principle.body}
                                </p>
                            </div>
                        </div>
                    </li>
                )
            })}
        </ol>
    )
}
