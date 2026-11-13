import type { Metadata } from 'next'

import { About } from '@/app/components/about/about'

export const metadata: Metadata = {
    title: 'About · Darkgrade',
    description:
        'The people behind Darkgrade: a small team in Denver, Colorado, building local-first AI for creative pros.',
    alternates: { canonical: '/about' },
}

export default function AboutPage() {
    return <About />
}
