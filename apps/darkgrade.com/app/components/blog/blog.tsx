import { FactStrip, SheetClosing, SheetHeadline, SheetPage } from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID, LINKS } from '@/app/components/site-links'

const DOCUMENT_NUMBER = 'DG-BL-001'

/* The words of the Blog page, until there is a blog on it. */
const BLOG = {
    headline: { first: 'Blog', second: 'coming', lit: 'soon.' },
    lede: 'What we are learning about cameras, local models and the cut will be written down on this page. Until it is, we say it out loud in Discord and in the open on GitHub.',
    facts: [
        { name: 'Status', value: 'Coming soon' },
        { name: 'Writing about', value: 'Cameras and local AI' },
        { name: 'Until then', value: 'Discord', href: LINKS.discord },
        { name: 'Write to us', value: LINKS.contactEmail, href: `mailto:${LINKS.contactEmail}` },
    ],
    closing: {
        line: 'Want to hear it first?',
        detail: 'Discord is where we think out loud while the blog is being written, and where the alpha is discussed every day.',
    },
} as const

/** The Blog page: there is no blog yet, and where to read us until there is. */
export function Blog() {
    return (
        <SheetPage name="Blog" title="What we are learning" document={DOCUMENT_NUMBER}>
            <SheetHeadline {...BLOG.headline} lede={BLOG.lede} />
            <FactStrip facts={BLOG.facts} />
            <SheetClosing line={BLOG.closing.line} detail={BLOG.closing.detail}>
                <a className={BTN_SOLID} href={LINKS.discord} target="_blank" rel="noopener">
                    Join the Discord
                </a>
                <a className={BTN_GHOST} href={LINKS.changelog}>
                    See the changelog
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
