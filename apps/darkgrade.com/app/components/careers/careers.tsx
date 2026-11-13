import { LINK, LINKS, STUDIO } from '@/app/components/home/content'
import { FactStrip, SheetClosing, SheetHeadline, SheetPage, SheetSection } from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID } from '@/app/components/site-links'

const DOCUMENT_NUMBER = 'DG-CR-001'

/* The words of the Careers page. */
const CAREERS = {
    headline: { first: 'No open roles', second: 'right', lit: 'now.' },
    lede: 'We’re a small team and we add people rarely. There’s nothing to apply for at the moment, but if you want to build with us, we’d like to hear from you anyway.',
    facts: [
        { name: 'Open roles', value: 'None at this time' },
        { name: 'Headquarters', value: 'Denver, Colorado' },
        { name: 'Source', value: 'Open on GitHub', href: LINKS.github },
        { name: 'Write to', value: LINKS.careersEmail, href: `mailto:${LINKS.careersEmail}` },
    ],
    closing: {
        line: 'Want to build with us?',
        detail: 'Send a note with something you’ve made and what you’d want to work on. A person reads every one.',
    },
} as const

/** What someone joining would work on: the two products, each with the line the home page says of it. */
const WORK = [LINK, STUDIO]

/**
 * The Careers page: there are no open roles, what the team works on, and where to write if you
 * would like to build with it anyway.
 */
export function Careers() {
    return (
        <SheetPage name="Careers" title="Working at Darkgrade" document={DOCUMENT_NUMBER}>
            <SheetHeadline {...CAREERS.headline} lede={CAREERS.lede} />
            <FactStrip facts={CAREERS.facts} />

            <SheetSection name="The work" title="What we build">
                <dl className="grid grid-cols-2 gap-x-[clamp(40px,7vw,130px)] gap-y-12 pt-[clamp(36px,6vh,64px)] max-[900px]:grid-cols-1">
                    {WORK.map((product, index) => (
                        <div key={product.name}>
                            <dt>
                                <span className="flex items-baseline gap-4 font-mono text-[11px] leading-[22px] tracking-[.18em] uppercase">
                                    <span className="text-ink-52">/{String(index + 1).padStart(2, '0')}</span>
                                    <span className="text-gold">{product.kind}</span>
                                </span>
                                <span className="mt-[10px] block font-serif text-[clamp(1.875rem,3vw,2.75rem)] leading-[1.04] heading-weight tracking-[-.045em]">
                                    {product.name}
                                </span>
                            </dt>
                            <dd className="mt-[clamp(14px,2vh,20px)] max-w-[44ch] text-body leading-[1.6] text-ink-66">
                                {product.does}
                            </dd>
                        </div>
                    ))}
                </dl>
            </SheetSection>

            <SheetClosing line={CAREERS.closing.line} detail={CAREERS.closing.detail}>
                <a className={BTN_SOLID} href={`mailto:${LINKS.careersEmail}`}>
                    {LINKS.careersEmail}
                </a>
                <a className={BTN_GHOST} href="/about">
                    Meet the team
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
