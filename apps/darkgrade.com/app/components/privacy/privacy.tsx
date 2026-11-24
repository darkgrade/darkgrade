import { FactStrip, SheetClosing, SheetHeadline, SheetPage } from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID, LINKS } from '@/app/components/site-links'

const DOCUMENT_NUMBER = 'DG-PP-001'

/* The words of the Privacy page, until the policy itself is published. They promise nothing about data: the policy will. */
const PRIVACY = {
    headline: { first: 'Privacy policy', second: 'coming', lit: 'soon.' },
    lede: 'Our privacy policy is being written, and will be published on this page. Until it is, ask us in Discord about your data and a person will answer.',
    facts: [
        { name: 'Status', value: 'Coming soon' },
        { name: 'Covers', value: 'This site, Slate and Studio' },
        { name: 'Source', value: 'Open on GitHub', href: LINKS.github },
        { name: 'Questions', value: 'Discord', href: LINKS.discord },
    ],
    closing: {
        line: 'A question about your data?',
        detail: 'Ask us directly. We’d rather answer one now than have you wait for the policy.',
    },
} as const

/** The Privacy page: the policy is not published yet, what it will cover, and where to ask in the meantime. */
export function Privacy() {
    return (
        <SheetPage name="Privacy" title="How we handle your data" document={DOCUMENT_NUMBER}>
            <SheetHeadline {...PRIVACY.headline} lede={PRIVACY.lede} />
            <FactStrip facts={PRIVACY.facts} />
            <SheetClosing line={PRIVACY.closing.line} detail={PRIVACY.closing.detail}>
                <a className={BTN_SOLID} href={LINKS.discord} target="_blank" rel="noopener">
                    Join the Discord
                </a>
                <a className={BTN_GHOST} href="/about">
                    About Darkgrade
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
