import { LINK, STUDIO } from '@/app/components/products'
import { LINKS, NPM_INSTALL } from '@/app/components/site-links'

/* The words of the home page. */

export { LINK, LINKS, NPM_INSTALL, STUDIO }

export const HERO = {
    eyebrow: 'Local-first AI for creative professionals',
    headline: ['Shoot more.', 'Edit less.'],
    lede: 'Darkgrade dials in your camera, captures the shot, and returns a finished first cut — on your own machine. You stay the director. Nothing leaves your computer unless you say so.',
    primary: { label: 'Watch it in action', href: LINKS.youtube },
    secondary: { label: 'Join the Discord', href: LINKS.discord },
} as const

export const MANIFESTO = [
    'Making videos is ten percent fun.',
    'The rest is menus and an edit that never ends.',
    'We’re deleting the rest.',
] as const

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
        title: 'Open & honest',
        body: 'A fair core that stays free, fair pricing for the app, no bait-and-switch.',
    },
    {
        index: '/04',
        title: 'Fast as your ideas',
        body: 'Camera manufacturers move in decades. An open product moves at the speed of its community.',
    },
] as const

export const DREAM = {
    eyebrow: 'The point of all this',
    line: 'Somewhere, two people have a podcast in their heads',
    turn: 'humanity will never hear.',
    punch: 'The world is still waiting on what you haven’t made yet.',
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
