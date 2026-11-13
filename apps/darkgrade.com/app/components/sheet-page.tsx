import { HomeFooter, HomeHeader } from '@/app/components/home/home-chrome'

/** The small capitals of a slate: the line at the top of a sheet, and the head of each of its sections. */
export const SLATE = 'font-mono text-[11px] leading-[22px] tracking-[.18em] uppercase'
export const HEADING = 'font-serif heading-weight tracking-[-.045em]'

interface SheetPageProps {
    /** What the page is, in a word, and in a few more, for the slate at its top. */
    name: string
    title: string
    /** The page's number in the site's set of drawings. */
    document: string
    children: React.ReactNode
}

/**
 * A page of words set as a sheet of the site's drawings: the header, a slate line naming the
 * sheet, its sections, and the footer. It is in the home page's type and hairlines, with no
 * picture of its own. The About and Careers pages are made of it.
 */
export function SheetPage({ name, title, document, children }: SheetPageProps) {
    return (
        <div className="relative min-h-dvh bg-bg text-ink">
            <HomeHeader overScrollingWords />
            <main className="shell pt-[76px] max-[900px]:pt-[38px]">
                <div className={`flex items-center justify-between gap-4 border-t border-hair pt-[10px] ${SLATE}`}>
                    <span className="flex items-center gap-4">
                        <span className="text-gold">{name}</span>
                        <span className="text-ink-66 max-[700px]:hidden">{title}</span>
                    </span>
                    <span className="text-ink-52">{document}</span>
                </div>
                {children}
            </main>
            <HomeFooter className="panel" />
        </div>
    )
}

interface SheetHeadlineProps {
    /** The headline's two lines; `lit` is the end of the second, set in the lamp's gold. */
    first: string
    second: string
    lit: string
    lede: string
}

/** The head of a sheet: a headline on two lines with its last words lit, and a paragraph beside it. */
export function SheetHeadline({ first, second, lit, lede }: SheetHeadlineProps) {
    return (
        <section className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-end gap-x-[clamp(32px,6vw,110px)] gap-y-8 pt-[clamp(64px,13vh,150px)] max-[900px]:grid-cols-1">
            <h1
                className={`${HEADING} ml-[-.04em] text-[clamp(2.25rem,5.5vw,6.25rem)] leading-[.96] tracking-[-.05em] whitespace-nowrap`}
            >
                <span className="block">{first}</span>
                <span className="block">
                    {second} <span className="glow-hot italic">{lit}</span>
                </span>
            </h1>
            <p className="max-w-[46ch] pb-[.6em] text-[clamp(1rem,1.15vw,1.1875rem)] leading-[1.6] text-ink-66">
                {lede}
            </p>
        </section>
    )
}

/** One cell of a fact strip. With `href` its value is a link: to another site, or an address to write to. */
export interface Fact {
    name: string
    value: string
    href?: string
}

/** Four facts in a row of ruled cells, as the title block of the home page has them. */
export function FactStrip({ facts }: { facts: readonly Fact[] }) {
    return (
        <dl className="mt-[clamp(48px,9vh,96px)] grid grid-cols-4 border border-hair font-mono text-[11px] leading-[1.5] tracking-[.18em] uppercase max-[900px]:grid-cols-2">
            {facts.map(fact => (
                <div
                    key={fact.name}
                    className="flex flex-col gap-[6px] border-l border-hair px-[18px] py-[13px] first:border-l-0 max-[900px]:[&:nth-child(3)]:border-l-0 max-[900px]:[&:nth-child(n+3)]:border-t"
                >
                    <dt className="text-ink-52">{fact.name}</dt>
                    <dd className="text-ink">
                        {fact.href ? (
                            <a
                                href={fact.href}
                                {...(fact.href.startsWith('http') ? { target: '_blank', rel: 'noopener' } : {})}
                                className="underline decoration-ink/30 underline-offset-[5px] transition-colors duration-300 hover:text-gold hover:decoration-gold"
                            >
                                {fact.value}
                            </a>
                        ) : (
                            fact.value
                        )}
                    </dd>
                </div>
            ))}
        </dl>
    )
}

/** A section of a sheet under its own slate line: what it is in gold, and a few words more. */
export function SheetSection({ name, title, children }: { name: string; title: string; children: React.ReactNode }) {
    return (
        <section className="pt-[clamp(72px,14vh,160px)]">
            <h2 className={`${SLATE} border-t border-hair pt-[10px] text-ink-66`}>
                <span className="mr-4 text-gold">{name}</span>
                {title}
            </h2>
            {children}
        </section>
    )
}

/** The foot of a sheet: a line and a sentence on the left, and what to do about them on the right. */
export function SheetClosing({ line, detail, children }: { line: string; detail: string; children: React.ReactNode }) {
    return (
        <section className="flex flex-wrap items-end justify-between gap-8 py-[clamp(72px,14vh,160px)]">
            <div>
                <h2 className={`${HEADING} text-[clamp(1.75rem,3.4vw,3.25rem)] leading-[1.04]`}>{line}</h2>
                <p className="mt-[14px] max-w-[48ch] text-body leading-[1.6] text-ink-66">{detail}</p>
            </div>
            <div className="flex flex-wrap gap-[14px]">{children}</div>
        </section>
    )
}
