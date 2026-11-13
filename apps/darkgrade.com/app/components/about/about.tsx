import { ABOUT, type Person, TEAM } from '@/app/components/about/team'
import { BACKED_BY, LINKS } from '@/app/components/home/content'
import {
    FactStrip,
    HEADING,
    SLATE,
    SheetClosing,
    SheetHeadline,
    SheetPage,
    SheetSection,
} from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID } from '@/app/components/site-links'

const DOCUMENT_NUMBER = 'DG-AB-001'
/** The backer whose batch the company went through: it is picked out in gold among the investors. */
const ACCELERATOR = 'Y Combinator'
/** The portraits are square files this many pixels across. */
const PORTRAIT_PIXELS = 460
/** A row of name and value between hairlines, as the product sections set their features. */
const RULED_ROW = 'flex items-baseline justify-between gap-5 border-t border-hair py-[11px] text-body'

/** One person: their portrait, their place in the team, name and role, their story in a paragraph, a few facts as ruled rows, and where else to find them. */
function PersonCard({ person, index }: { person: Person; index: number }) {
    return (
        // The four parts of a card share the rows of the grid the cards stand in, so the same part of each lines up across them whatever the length of a story.
        <article className="row-span-4 grid grid-rows-subgrid gap-y-0">
            <div className="flex items-center gap-[clamp(16px,2vw,26px)]">
                {/* The portrait is shown in grey under a wash of the page's gold, so two photographs taken anywhere sit in the page's palette; it comes up in its own colours under the pointer. A plain img: the files are small squares, already the size they are shown at on a dense screen. */}
                <span className="group/portrait relative block size-[clamp(84px,8.6vw,124px)] shrink-0 overflow-hidden rounded-[10px] border border-hair">
                    <img
                        src={person.portrait}
                        alt={person.name}
                        width={PORTRAIT_PIXELS}
                        height={PORTRAIT_PIXELS}
                        loading="lazy"
                        className="size-full object-cover brightness-[.8] contrast-[1.1] grayscale transition-[filter] duration-500 group-hover/portrait:brightness-100 group-hover/portrait:contrast-100 group-hover/portrait:grayscale-0"
                    />
                    <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 bg-gold opacity-25 mix-blend-color transition-opacity duration-500 group-hover/portrait:opacity-0"
                    />
                </span>
                <div>
                    <p className={`flex items-baseline gap-4 ${SLATE}`}>
                        <span className="text-ink-52">/{String(index + 1).padStart(2, '0')}</span>
                        <span className="text-gold">{person.role}</span>
                    </p>
                    <h3 className={`${HEADING} mt-[10px] text-[clamp(1.875rem,3vw,2.75rem)] leading-[1.04]`}>
                        {person.name}
                    </h3>
                </div>
            </div>
            <p className="mt-[clamp(18px,2.6vh,26px)] text-body leading-[1.6] text-ink-66">{person.story}</p>
            <dl className="mt-[clamp(20px,3vh,30px)] border-b border-hair">
                {person.facts.map(fact => (
                    <div key={fact.name} className={RULED_ROW}>
                        <dt className="shrink-0 font-mono text-[10.5px] tracking-[.08em] text-ink-52 uppercase">
                            {fact.name}
                        </dt>
                        <dd className="text-right text-ink">{fact.value}</dd>
                    </div>
                ))}
            </dl>
            <p className="mt-[18px] flex flex-wrap gap-x-6 gap-y-2 text-[14px]">
                {person.links.map(link => (
                    <a
                        key={link.href}
                        href={link.href}
                        target="_blank"
                        rel="noopener"
                        className="text-ink-66 transition-colors duration-300 hover:text-gold"
                    >
                        {link.label}
                    </a>
                ))}
            </p>
        </article>
    )
}

/**
 * The About page: what Darkgrade is in a line, a few facts about the company, the people who
 * make it, and who backs it.
 */
export function About() {
    return (
        <SheetPage name="About" title="The people behind Darkgrade" document={DOCUMENT_NUMBER}>
            <SheetHeadline {...ABOUT.headline} lede={ABOUT.lede} />
            <FactStrip facts={ABOUT.company} />

            <SheetSection name="Team" title="Who makes it">
                <div className="grid grid-cols-2 gap-x-[clamp(40px,7vw,130px)] gap-y-[72px] pt-[clamp(36px,6vh,64px)] max-[900px]:grid-cols-1">
                    {TEAM.map((person, index) => (
                        <PersonCard key={person.name} person={person} index={index} />
                    ))}
                </div>
            </SheetSection>

            <SheetSection name="Backed by" title="Our investors">
                <ul className="grid grid-cols-4 gap-x-10 pt-[clamp(20px,3vh,32px)] text-body max-[900px]:grid-cols-2 max-[520px]:grid-cols-1">
                    {BACKED_BY.map(backer => (
                        <li
                            key={backer}
                            className={`border-b border-hair py-[12px] ${backer === ACCELERATOR ? 'text-gold' : 'text-ink'}`}
                        >
                            {backer}
                        </li>
                    ))}
                </ul>
            </SheetSection>

            <SheetClosing line={ABOUT.closing.line} detail={ABOUT.closing.detail}>
                <a className={BTN_SOLID} href={LINKS.careers}>
                    Careers
                </a>
                <a className={BTN_GHOST} href={LINKS.discord} target="_blank" rel="noopener">
                    Join the Discord
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
