import { LINKS } from '@/app/components/site-links'

/* The words of the About page. */

/** One line of what is known of someone, set as a ruled row: where they were before, where they studied. */
export interface PersonFact {
    name: string
    value: string
}

export interface Person {
    name: string
    role: string
    /** Their portrait, square, under /public. */
    portrait: string
    story: string
    facts: PersonFact[]
    /** The same three for everyone, in the same order: GitHub, LinkedIn, their own site. */
    links: { label: string; href: string }[]
}

export const ABOUT = {
    /** The headline's two lines; the last word of the second is the one that is lit. */
    headline: { first: 'We’re betting', second: 'on', lit: 'people.' },
    lede: 'Darkgrade is a small team headquartered in Denver, Colorado, building local-first AI for creative pros. We believe good taste can’t be automated, and authentic human connection cannot be engineered. Our mission is to build better tools, so creators can tell better stories.',
    company: [
        { name: 'Headquarters', value: 'Denver, Colorado' },
        { name: 'Y Combinator', value: 'F24 batch', href: LINKS.yCombinator },
        { name: 'Source', value: 'Open on GitHub', href: LINKS.github },
        { name: 'Status', value: 'In alpha' },
    ],
    closing: {
        line: 'Want to build this with us?',
        detail: 'There are no open roles right now, but we like hearing from people who build. If cameras, hardware or local models are your thing, say hello.',
    },
} as const

export const TEAM: Person[] = [
    {
        name: 'Kevin Schaich',
        role: 'Founder & CEO',
        portrait: '/team/kevin-schaich.jpg',
        story: 'Kevin has been a photographer and filmmaker for 15 years. He spent five years at Palantir wrangling data for Fortune 500 companies around the world, then founded Darkgrade and took it through Y Combinator’s F24 batch.',
        facts: [
            { name: 'Before', value: 'Palantir' },
            { name: 'Studied', value: 'Computer Science, Cornell' },
            { name: 'Based', value: 'Denver, Colorado' },
        ],
        links: [
            { label: 'GitHub', href: 'https://github.com/kevinschaich' },
            { label: 'LinkedIn', href: 'https://www.linkedin.com/in/kevinschaich/' },
            { label: 'kevinschaich.com', href: 'https://kevinschaich.com' },
        ],
    },
    {
        name: 'Cyril Engmann',
        role: 'Head of Hardware Systems',
        portrait: '/team/cyril-engmann.jpg',
        story: 'Cyril started The Garage, a boutique hardware agency in Brooklyn, where he builds hardware end to end, most recently a five-sensor camera that makes 3D images.',
        facts: [
            { name: 'Before', value: 'The Garage' },
            { name: 'Studied', value: 'Computer Engineering, UT Austin' },
            { name: 'Based', value: 'Brooklyn, NY' },
        ],
        links: [
            { label: 'GitHub', href: 'https://github.com/NickEngmann' },
            { label: 'LinkedIn', href: 'https://www.linkedin.com/in/cyril-engmann/' },
            { label: 'nickengmann.com', href: 'https://nickengmann.com' },
        ],
    },
]
