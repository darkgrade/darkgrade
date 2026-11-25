import { FactStrip, SheetClosing, SheetHeadline, SheetPage, SheetSection } from '@/app/components/sheet-page'
import { BTN_GHOST, BTN_SOLID, LINKS } from '@/app/components/site-links'

const DOCUMENT_NUMBER = 'DG-PP-001'

/** A terminal command and, in a sentence, what running it does. */
interface PolicyCommand {
    command: string
    does: string
}

/** One thing that reaches us. Every section answers the same five questions; `controls` is a sentence, or the commands that do it. */
interface PolicySection {
    name: string
    collect: string
    never: string
    services: string
    why: string
    controls: string | readonly PolicyCommand[]
}

/*
 * The words of the Privacy page. Every line states what the code does today (the site's PostHog
 * setup, Slate's diagnostics client and the telemetry collector), except the uses of a linked
 * email, which state what we intend. Change them together.
 */
const PRIVACY = {
    headline: { first: 'Privacy Policy' },
    lede: 'Data we collect, why we collect it, which services we use, and the controls you have.',
    facts: [
        { name: 'Effective', value: 'November 24, 2026' },
        { name: 'Covers', value: 'This site, Slate, Studio, CLI, Matrix' },
        { name: 'Source', value: 'Open on GitHub', href: LINKS.github },
        { name: 'Questions', value: 'Discord', href: LINKS.discord },
    ],
    closing: {
        line: 'Questions about your data?',
        detail: 'Read our code or reach out.',
    },
} as const

const SECTIONS: readonly PolicySection[] = [
    {
        name: 'This site',
        collect:
            'The pages you open, how far you scroll, where you click and move the pointer, where you came from, your browser, device, screen size and language, how fast pages load, and your IP address with the approximate location it gives. We use cookies.',
        never: 'Anything for third-party advertisers.',
        services: 'PostHog, our analytics provider; Vercel, our web hosting provider; and Mintlify, our docs provider.',
        why: 'To improve our marketing.',
        controls: 'Use an ad blocker.',
    },
    {
        name: 'Our software',
        collect:
            'Opt-out camera diagnostics covering your camera’s make, model and firmware, the Slate version, the kind of connection, each command’s code, response, timing and size, and the capabilities and settings the camera reports or is sent. A random ID stands for your installation, and hashed serial numbers for your cameras.',
        never: 'Your photos, video, audio or transcripts, raw serial numbers, network settings or passwords.',
        services:
            'Google Cloud in the United States, and Matrix, our in-house camera compatibility framework. Diagnostics may be visible to cloud models. Studio downloads models and runtimes from Hugging Face, GitHub and PyPI.',
        why: 'To improve our products and make them work with more cameras.',
        controls: [
            { command: 'darkgrade telemetry opt-out', does: 'Stops sharing diagnostics from this machine.' },
            {
                command: 'darkgrade telemetry delete',
                does: 'Stops sharing and deletes the diagnostics and email this installation has shared.',
            },
        ],
    },
    {
        name: 'Your email',
        collect: 'The address you give us, and only if you link one in Studio or the CLI.',
        never: 'Any email address you haven’t linked yourself.',
        services: 'Google Cloud in the United States; and Resend, our email provider.',
        why: 'To find your sessions when you request support.',
        controls: [{ command: 'darkgrade telemetry logout', does: 'Unlinks your email and leaves sharing as it is.' }],
    },
]

/** A section's five lines, the same five in every section, each a ruled row: the question in the slate's capitals on the left, and its answer beside it. */
function PolicyRows({ section }: { section: PolicySection }) {
    const rows = [
        { name: 'We collect', answer: section.collect },
        { name: 'We do not collect', answer: section.never },
        { name: 'Services we use', answer: section.services },
        { name: 'Why', answer: section.why },
        { name: 'Your controls', answer: section.controls },
    ]
    return (
        <dl className="pt-[clamp(20px,3vh,32px)]">
            {rows.map(row => (
                <div
                    key={row.name}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-x-[clamp(32px,6vw,110px)] gap-y-[6px] border-b border-hair py-[18px] max-[900px]:grid-cols-1"
                >
                    <dt className="font-mono text-[11px] leading-[24px] tracking-[.18em] text-ink-52 uppercase">
                        {row.name}
                    </dt>
                    <dd className="max-w-[64ch] text-body leading-[1.6] text-ink-66">
                        {typeof row.answer === 'string'
                            ? row.answer
                            : row.answer.map(({ command, does }) => (
                                  <span key={command} className="block [&:not(:first-child)]:mt-[12px]">
                                      <code className="block font-mono text-[13px] leading-[1.7] text-ink">
                                          {command}
                                      </code>
                                      {does}
                                  </span>
                              ))}
                    </dd>
                </div>
            ))}
        </dl>
    )
}

/**
 * The Privacy page: the three things that reach us, each answered the same way — what we
 * collect, what we do not, the services we use, why, and the controls you have.
 */
export function Privacy() {
    return (
        <SheetPage name="Privacy" title="How we handle your data" document={DOCUMENT_NUMBER}>
            <SheetHeadline {...PRIVACY.headline} lede={PRIVACY.lede} />
            <FactStrip facts={PRIVACY.facts} />

            {SECTIONS.map(section => (
                <SheetSection key={section.name} name={section.name}>
                    <PolicyRows section={section} />
                </SheetSection>
            ))}

            <SheetClosing line={PRIVACY.closing.line} detail={PRIVACY.closing.detail}>
                <a className={BTN_SOLID} href={LINKS.discord} target="_blank" rel="noopener">
                    Join the Discord
                </a>
                <a className={BTN_GHOST} href={LINKS.github} target="_blank" rel="noopener">
                    Read the source
                </a>
            </SheetClosing>
        </SheetPage>
    )
}
