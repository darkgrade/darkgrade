import { FactStrip, SheetClosing, SheetHeadline, SheetPage } from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID, LINKS } from '@/app/components/site-links'

const DOCUMENT_NUMBER = 'DG-CL-001'

/* The words of the Changelog page, until there is a changelog on it. */
const CHANGELOG = {
    headline: { first: 'Changelog', second: 'coming', lit: 'soon.' },
    lede: 'A dated record of what ships in Link and Studio will live on this page. Until it does, every change is public in the repository, the day it’s made.',
    facts: [
        { name: 'Status', value: 'Coming soon' },
        { name: 'Stage', value: 'In alpha' },
        { name: 'Until then', value: 'Commits on GitHub', href: LINKS.commits },
        { name: 'Talk to us', value: 'Discord', href: LINKS.discord },
    ],
    closing: {
        line: 'Want to see what changed today?',
        detail: 'The repository is the changelog for now. Discord is where we say what’s coming next.',
    },
} as const

/** The Changelog page: there is no changelog yet, and where the changes can be followed until there is. */
export function Changelog() {
    return (
        <SheetPage name="Changelog" title="What has shipped" document={DOCUMENT_NUMBER}>
            <SheetHeadline {...CHANGELOG.headline} lede={CHANGELOG.lede} />
            <FactStrip facts={CHANGELOG.facts} />
            <SheetClosing line={CHANGELOG.closing.line} detail={CHANGELOG.closing.detail}>
                <a className={BTN_SOLID} href={LINKS.commits} target="_blank" rel="noopener">
                    See the commits
                </a>
                <a className={BTN_GHOST} href={LINKS.discord} target="_blank" rel="noopener">
                    Join the Discord
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
