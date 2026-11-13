import { LINK, STUDIO } from '@/app/components/products'
import { LINKS, NPM_INSTALL } from '@/app/components/site-links'

/* The words of the home page. */

export { LINK, LINKS, NPM_INSTALL, STUDIO }

export const HERO = {
    eyebrow: 'Local-first AI for creative professionals',
    headline: ['Shoot more.', 'Edit less.'],
    lede: 'Darkgrade dials in your camera, captures the shot, and returns a finished first cut — on your own machine. You stay the director. Nothing leaves your computer unless you say so.',
    /** The button that plays the page through from its start. */
    watch: 'Watch it in action',
    /** The waitlist is kept on the Discord until it has a form of its own. */
    secondary: { label: 'Join the alpha waitlist', href: LINKS.discord },
} as const

export const MANIFESTO = ['Record is one button.', 'The rest are in your way.', 'We’re deleting the rest.'] as const

export const PRINCIPLES = [
    {
        index: '/01',
        title: 'You’re never replaced',
        body: 'No AI slop, no fake people. We make your real footage move faster — and give you back your evenings.',
    },
    {
        index: '/02',
        title: 'Local-first & private',
        body: 'Everything runs on your machine by default. We don’t train on your footage.',
    },
    {
        index: '/03',
        title: 'Open & fair',
        body: 'The core is free, and stays free. The app is priced fairly, with no bait-and-switch.',
        /** A line of its own under the body, all of it a link. */
        link: { label: 'Our code is on GitHub. Read it here.', href: LINKS.github },
    },
    {
        index: '/04',
        title: 'Better tools, better stories',
        body: 'We believe good taste can’t be automated, and authentic human connection cannot be engineered. Our mission is to build better tools, so creators can tell better stories.',
    },
] as const

export const DREAM = {
    eyebrow: 'The point of all this',
    line: 'Somewhere, two people have a podcast in their heads',
    turn: 'humanity will never hear.',
    punch: 'The world is still waiting on what you haven’t made yet.',
    /** The one button under the closing words: it goes to the Discord. */
    action: 'Help shape our future',
} as const

export const TESTED_ON = [
    'Sony A7 IV',
    'Canon EOS 80D',
    'Sony A7III',
    'Sony A7V',
    'Canon R6 Mk III',
    'Sony FX2',
    'Nikon Z6 III',
    'Sony A6700',
    'Olympus E-PL5',
] as const

export const BACKED_BY = [
    'Y Combinator',
    'Orange Collective',
    'Forward Deployed VC',
    'Coughdrop Capital',
    'Tango.vc',
    'DTX Ventures',
    'Transpose Platform',
    'Imagination Capital',
    'Good AI Capital',
    '5x5 Studio',
    'NewAlpha VC',
] as const

export const EXPERIMENTS = [
    { name: 'Toolbench', description: 'Local models that make tool calls', href: '/toolbench/' },
    { name: 'Voicebench', description: 'Speech models on real voices', href: '/voicebench/' },
    { name: 'Cambench', description: 'Camera specs, verified across sources', href: '/cambench/' },
] as const
